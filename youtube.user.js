// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube
// @namespace    lyricsoverlay.bridge
// @version      1.2
// @description  Sends YouTube captions (timed, synced) to LyricsOverlay via localhost
// @author       you
// @match        https://www.youtube.com/watch*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ── Config ───────────────────────────────────────────────────────────────
    var PORT    = 7331;
    var POLL_MS = 100;

    // ── State ────────────────────────────────────────────────────────────────
    var captionEvents = [];   // parsed json3 events with timing
    var syncTimer     = null;
    var lastMain      = null;
    var lastUpc       = null;

    // ── Send helpers ─────────────────────────────────────────────────────────
    function send(main, upcoming) {
        if (main === lastMain && upcoming === lastUpc) return;
        lastMain = main;
        lastUpc  = upcoming;
        GM_xmlhttpRequest({
            method:  'POST',
            url:     'http://localhost:' + PORT + '/subtitle',
            headers: { 'Content-Type': 'application/json' },
            data:    JSON.stringify({ main: main, upcoming: upcoming }),
            onerror: function () {}   // app not running — silently ignore
        });
    }

    function clear() {
        lastMain = null; lastUpc = null;
        GM_xmlhttpRequest({ method: 'POST', url: 'http://localhost:' + PORT + '/clear', onerror: function(){} });
    }

    // ── Caption event helpers ─────────────────────────────────────────────────
    // YouTube json3 format: events[] each has tStartMs, dDurationMs, segs[{utf8}]
    function evText(ev) {
        if (!ev || !ev.segs) return '';
        return ev.segs.map(function (s) { return s.utf8 || ''; }).join('').replace(/\n/g, ' ').trim();
    }

    // ── Sync loop: called every POLL_MS ──────────────────────────────────────
    function syncLoop() {
        var video = document.querySelector('video');
        if (!video) { send('', ''); return; }

        var ms = video.currentTime * 1000;

        // If we have a parsed caption track — use it (most accurate)
        if (captionEvents.length > 0) {
            var curIdx = -1;
            for (var i = 0; i < captionEvents.length; i++) {
                var ev    = captionEvents[i];
                var start = ev.tStartMs    || 0;
                var end   = start + (ev.dDurationMs || 0);
                if (ms >= start && ms < end) { curIdx = i; break; }
            }

            var main = curIdx >= 0 ? evText(captionEvents[curIdx]) : '';

            // Next non-empty event for upcoming
            var upc = '';
            var scanFrom = (curIdx >= 0 ? curIdx + 1 : 0);
            for (var j = scanFrom; j < captionEvents.length; j++) {
                var t = evText(captionEvents[j]);
                if (t) { upc = t; break; }
            }

            send(main, upc);
            return;
        }

        // Fallback: read caption overlay DOM (no timing data → no upcoming)
        var segs = document.querySelectorAll('.ytp-caption-segment');
        var domText = '';
        for (var k = 0; k < segs.length; k++) domText += segs[k].textContent;
        send(domText.trim(), '');
    }

    // ── Fetch caption track from YouTube's TimedText API ─────────────────────
    function fetchTrackUrl(url) {
        // Force json3 format
        var trackUrl = url.replace(/&fmt=[^&]*/g, '').replace(/\?fmt=[^&]*/g, '') + '&fmt=json3';
        GM_xmlhttpRequest({
            method: 'GET',
            url:    trackUrl,
            onload: function (resp) {
                try {
                    var data = JSON.parse(resp.responseText);
                    if (data && data.events) {
                        captionEvents = data.events.filter(function (ev) {
                            return ev.segs && ev.segs.some(function (s) {
                                return s.utf8 && s.utf8.trim().length > 0;
                            });
                        });
                    }
                } catch (e) {}
            },
            onerror: function () {}
        });
    }

    // ── Intercept YouTube's own timedtext XHR so we grab the URL dynamically ─
    // (Handles the case where ytInitialPlayerResponse already resolved and
    //  YouTube fetches the track itself; we piggyback on that request.)
    (function patchXHR() {
        var origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        var origSend = unsafeWindow.XMLHttpRequest.prototype.send;

        unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
            this._lo_url = (typeof url === 'string') ? url : '';
            return origOpen.apply(this, arguments);
        };

        unsafeWindow.XMLHttpRequest.prototype.send = function (body) {
            var xhr = this;
            if (xhr._lo_url && xhr._lo_url.indexOf('timedtext') !== -1 &&
                xhr._lo_url.indexOf('fmt=json3') !== -1) {
                xhr.addEventListener('load', function () {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data && data.events && data.events.length > 0) {
                            captionEvents = data.events.filter(function (ev) {
                                return ev.segs && ev.segs.some(function (s) {
                                    return s.utf8 && s.utf8.trim().length > 0;
                                });
                            });
                        }
                    } catch (e) {}
                });
            }
            return origSend.apply(this, arguments);
        };
    })();

    // ── Also intercept fetch (YouTube uses fetch in some paths) ───────────────
    (function patchFetch() {
        var origFetch = unsafeWindow.fetch;
        unsafeWindow.fetch = function () {
            var args   = arguments;
            var result = origFetch.apply(unsafeWindow, args);
            try {
                var url = args[0] ? args[0].toString() : '';
                if (url.indexOf('timedtext') !== -1 && url.indexOf('fmt=json3') !== -1) {
                    result.then(function (resp) {
                        resp.clone().json().then(function (data) {
                            if (data && data.events && data.events.length > 0) {
                                captionEvents = data.events.filter(function (ev) {
                                    return ev.segs && ev.segs.some(function (s) {
                                        return s.utf8 && s.utf8.trim().length > 0;
                                    });
                                });
                            }
                        }).catch(function () {});
                    }).catch(function () {});
                }
            } catch (e) {}
            return result;
        };
    })();

    // ── Read ytInitialPlayerResponse to grab caption track URL proactively ────
    function initFromPlayerResponse() {
        try {
            var pr = unsafeWindow.ytInitialPlayerResponse;
            if (!pr) return;

            var ctl = pr.captions &&
                      pr.captions.playerCaptionsTracklistRenderer &&
                      pr.captions.playerCaptionsTracklistRenderer.captionTracks;
            if (!ctl || ctl.length === 0) return;

            // Prefer ASR (auto-generated); fall back to first track
            var track = ctl[0];
            for (var i = 0; i < ctl.length; i++) {
                if (ctl[i].kind === 'asr') { track = ctl[i]; break; }
            }
            if (track && track.baseUrl) fetchTrackUrl(track.baseUrl);
        } catch (e) {}
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    function startSync() {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(syncLoop, POLL_MS);
    }

    function stopSync() {
        if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
        captionEvents = [];
        clear();
    }

    function onVideoLoad() {
        stopSync();
        captionEvents = [];
        // Wait for YouTube to populate ytInitialPlayerResponse after SPA navigation
        setTimeout(function () { initFromPlayerResponse(); }, 2000);
        startSync();
    }

    // On initial page load
    window.addEventListener('load', onVideoLoad);

    // YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', function () {
        if (window.location.pathname === '/watch') onVideoLoad();
        else stopSync();
    });
    document.addEventListener('yt-navigate-start', stopSync);

    // Fallback: if load event already fired (script injected late)
    if (document.readyState === 'complete') onVideoLoad();

})();

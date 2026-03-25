// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube
// @namespace    lyricsoverlay.bridge
// @version      1.9
// @description  Sends YouTube captions to LyricsOverlay. (Perfect Immediate Sync & Tolerance Fix!)
// @author       you & your lovely AI
// @match        https://www.youtube.com/watch*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var PORT    = 7331;
    var POLL_MS = 100;

    // ── STATE & TOGGLE ───────────────────────────────────────────────────────
    var showAllLines = GM_getValue('showAllLines', true);
    var menuId = null;

    function toggleMode() {
        showAllLines = !showAllLines;
        GM_setValue('showAllLines', showAllLines);
        updateMenu();
        lastMain = null;
    }

    function updateMenu() {
        if (menuId !== null) GM_unregisterMenuCommand(menuId);
        var label = showAllLines ? "🔄 Mode: Tampilkan SEMUA Baris" : "🔄 Mode: Baris ATAS Saja (Romaji)";
        menuId = GM_registerMenuCommand(label, toggleMode);
    }
    updateMenu();

    window.addEventListener('keydown', function(e) {
        if (e.altKey && e.key.toLowerCase() === 'l') toggleMode();
    });

    // ── PRE-PROCESSOR SAKTI (Ngejahit Timestamp yg beda tipis) ───────────────
    function normalizeEvents(rawEvents) {
        if (!rawEvents) return [];
        // Buang yang kosong
        var valid = rawEvents.filter(function(ev) {
            return ev.segs && ev.segs.some(function(s){ return s.utf8 && s.utf8.trim().length > 0; });
        });

        // Urutin berdasarkan waktu mulai
        valid.sort(function(a, b) { return (a.tStartMs || 0) - (b.tStartMs || 0); });

        // Jahit waktu yang bedanya <= 150ms biar mereka bener-bener jadi 1 kesatuan
        for (var i = 1; i < valid.length; i++) {
            var prev = valid[i-1], curr = valid[i];
            var pStart = prev.tStartMs || 0, cStart = curr.tStartMs || 0;
            var pEnd = pStart + (prev.dDurationMs || 0), cEnd = cStart + (curr.dDurationMs || 0);

            // Kalau mulainya hampir barengan (Romaji telat masuk)
            if (Math.abs(cStart - pStart) <= 150) {
                var minS = Math.min(pStart, cStart);
                prev.tStartMs = minS; curr.tStartMs = minS;
                prev.dDurationMs = pEnd - minS; curr.dDurationMs = cEnd - minS;
            }
            // Kalau selesainya hampir barengan
            if (Math.abs(cEnd - pEnd) <= 150) {
                var maxE = Math.max(pEnd, cEnd);
                prev.dDurationMs = maxE - prev.tStartMs; curr.dDurationMs = maxE - curr.tStartMs;
            }
        }
        return valid;
    }

    // ── SYNC LOGIC ────────────────────────────────────────────────────────────
    var captionEvents = [];
    var syncTimer     = null;
    var lastMain      = null;
    var lastUpc       = null;

    function send(main, upcoming) {
        if (main === lastMain && upcoming === lastUpc) return;
        lastMain = main;
        lastUpc  = upcoming;
        GM_xmlhttpRequest({
            method:  'POST',
            url:     'http://localhost:' + PORT + '/subtitle',
            headers: { 'Content-Type': 'application/json' },
            data:    JSON.stringify({ main: main, upcoming: upcoming }),
            onerror: function () {}
        });
    }

    function clear() {
        lastMain = null; lastUpc = null;
        GM_xmlhttpRequest({ method: 'POST', url: 'http://localhost:' + PORT + '/clear', onerror: function(){} });
    }

    function evText(ev) {
        if (!ev || !ev.segs) return '';
        return ev.segs.map(function (s) { return s.utf8 || ''; }).join('').trim();
    }

    function syncLoop() {
        var video = document.querySelector('video');
        if (!video) { send('', ''); return; }

        var ms = video.currentTime * 1000;

        if (captionEvents.length > 0) {
            // STRICT MODE: Gak ada lagi toleransi waktu! Main bersih!
            var activeEvents = captionEvents.filter(function(ev) {
                var start = ev.tStartMs || 0;
                var end = start + (ev.dDurationMs || 0);
                return ms >= start && ms < end;
            });

            if (activeEvents.length > 0) {
                var texts = activeEvents.map(evText).filter(function(t) { return t !== ''; });
                var main = '';

                if (showAllLines) {
                    var uniqueTexts = texts.filter(function(item, pos) { return texts.indexOf(item) == pos; });
                    main = uniqueTexts.join('\n').trim();
                } else {
                    var chosenBlock = texts.length > 1 ? texts[texts.length - 1] : texts[0];
                    main = chosenBlock.split('\n')[0].trim();
                }

                var upc = '';
                var lastActiveEv = activeEvents[activeEvents.length - 1];
                var curIdx = captionEvents.indexOf(lastActiveEv);
                for (var j = curIdx + 1; j < captionEvents.length; j++) {
                    var upcomingBlock = evText(captionEvents[j]);
                    if (upcomingBlock) {
                        upc = showAllLines ? upcomingBlock : upcomingBlock.split('\n')[0].trim();
                        break;
                    }
                }

                send(main, upc);
            } else {
                send('', '');
            }
            return;
        }

        // DOM Fallback
        var windows = document.querySelectorAll('.ytp-caption-window-bottom, .ytp-caption-window-top');
        if (windows.length > 0) {
            var domText = windows[0].innerText || windows[0].textContent;
            var domOutput = showAllLines ? domText.trim() : domText.trim().split('\n')[0].trim();
            send(domOutput, '');
        } else {
            send('', '');
        }
    }

    // ── XHR & FETCH INTERCEPTS ────────────────────────────────────────────────
    function fetchTrackUrl(url) {
        var trackUrl = url.replace(/&fmt=[^&]*/g, '').replace(/\?fmt=[^&]*/g, '') + '&fmt=json3';
        GM_xmlhttpRequest({
            method: 'GET', url: trackUrl,
            onload: function (resp) {
                try {
                    var data = JSON.parse(resp.responseText);
                    if (data && data.events) {
                        captionEvents = normalizeEvents(data.events);
                    }
                } catch (e) {}
            }
        });
    }

    (function patchXHR() {
        var origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        var origSend = unsafeWindow.XMLHttpRequest.prototype.send;
        unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
            this._lo_url = (typeof url === 'string') ? url : '';
            return origOpen.apply(this, arguments);
        };
        unsafeWindow.XMLHttpRequest.prototype.send = function (body) {
            var xhr = this;
            if (xhr._lo_url && xhr._lo_url.indexOf('timedtext') !== -1 && xhr._lo_url.indexOf('fmt=json3') !== -1) {
                xhr.addEventListener('load', function () {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data && data.events) {
                            captionEvents = normalizeEvents(data.events);
                        }
                    } catch (e) {}
                });
            }
            return origSend.apply(this, arguments);
        };
    })();

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
                            if (data && data.events) {
                                captionEvents = normalizeEvents(data.events);
                            }
                        }).catch(function () {});
                    }).catch(function () {});
                }
            } catch (e) {}
            return result;
        };
    })();

    function initFromPlayerResponse() {
        try {
            var pr = unsafeWindow.ytInitialPlayerResponse;
            var player = document.querySelector('#movie_player');
            if (player && typeof player.getPlayerResponse === 'function') {
                var pr_fresh = player.getPlayerResponse();
                if (pr_fresh) pr = pr_fresh;
            }

            if (!pr) return;
            var ctl = pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
            if (!ctl || ctl.length === 0) return;

            var track = ctl[0];
            for (var i = 0; i < ctl.length; i++) { if (ctl[i].kind === 'asr') { track = ctl[i]; break; } }
            if (track && track.baseUrl) fetchTrackUrl(track.baseUrl);
        } catch (e) {}
    }

    function startSync() {
        if (!syncTimer) syncTimer = setInterval(syncLoop, POLL_MS);
    }

    function stopSync() {
        if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
        clear();
    }

    function onVideoLoad() {
        startSync();
        setTimeout(function () {
            if (captionEvents.length === 0) initFromPlayerResponse();
        }, 2000);
    }

    window.addEventListener('load', onVideoLoad);

    document.addEventListener('yt-navigate-start', function() {
        captionEvents = [];
        clear();
    });

    document.addEventListener('yt-navigate-finish', function () {
        if (window.location.pathname === '/watch') onVideoLoad();
        else stopSync();
    });

    if (document.readyState === 'complete') onVideoLoad();

})();
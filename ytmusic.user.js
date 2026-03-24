// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube Music
// @namespace    lyricsoverlay.bridge
// @version      1.2
// @description  Sends YouTube Music synced lyrics to LyricsOverlay via localhost
// @author       you
// @match        https://music.youtube.com/*
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
    var lyricsLines = [];   // [{ startTimeMs, words }]  — from timed lyrics API
    var lastMain    = null;
    var lastUpc     = null;
    var lastVideoId = '';

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
            onerror: function () {}
        });
    }

    function clear() {
        lastMain = null; lastUpc = null; lyricsLines = [];
        GM_xmlhttpRequest({ method: 'POST', url: 'http://localhost:' + PORT + '/clear', onerror: function(){} });
    }

    // ── Deep search for a key inside a nested object ──────────────────────────
    // maxDepth prevents slowdown on huge API responses
    function findDeep(obj, key, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 18 || !obj || typeof obj !== 'object') return undefined;
        if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            var found = findDeep(obj[keys[i]], key, depth + 1);
            if (found !== undefined) return found;
        }
        return undefined;
    }

    // ── Try to extract timed lyrics from a YTM API response ──────────────────
    // YTM stores timed lyrics under different keys depending on version.
    // We try several known locations.
    function tryExtractTimedLyrics(data) {
        // Attempt 1: timedLyricsLine (seen in some versions)
        var tll = findDeep(data, 'timedLyricsLine');
        if (tll && Array.isArray(tll) && tll.length > 0) {
            var parsed = [];
            for (var i = 0; i < tll.length; i++) {
                var line  = tll[i];
                var words = line.lyricLine || line.text || '';
                var ms    = 0;
                if (line.cueRange) {
                    ms = parseInt(line.cueRange.startTimeMilliseconds || line.cueRange.start || 0, 10);
                } else if (line.startTimeMs !== undefined) {
                    ms = parseInt(line.startTimeMs, 10);
                }
                if (words.trim()) parsed.push({ startTimeMs: ms, words: words.trim() });
            }
            if (parsed.length > 0) { lyricsLines = parsed; return true; }
        }

        // Attempt 2: lyricsData.lyrics.lines (some API shapes)
        var lyricsData = findDeep(data, 'lyricsData');
        if (lyricsData) {
            var lines = findDeep(lyricsData, 'lines');
            if (lines && Array.isArray(lines) && lines.length > 0) {
                var parsed2 = [];
                for (var j = 0; j < lines.length; j++) {
                    var w  = (lines[j].words || lines[j].lyricLine || '').trim();
                    var ms2 = parseInt(lines[j].startTimeMs || 0, 10);
                    if (w) parsed2.push({ startTimeMs: ms2, words: w });
                }
                if (parsed2.length > 0) { lyricsLines = parsed2; return true; }
            }
        }

        return false;
    }

    // ── Intercept XHR (/youtubei/v1/next and /browse carry lyrics) ───────────
    (function patchXHR() {
        var origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        var origSend = unsafeWindow.XMLHttpRequest.prototype.send;

        unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
            this._ytm_url = (typeof url === 'string') ? url : '';
            return origOpen.apply(this, arguments);
        };

        unsafeWindow.XMLHttpRequest.prototype.send = function (body) {
            var xhr = this;
            var url = xhr._ytm_url || '';
            if (url.indexOf('/next') !== -1 || url.indexOf('/browse') !== -1) {
                xhr.addEventListener('load', function () {
                    try { tryExtractTimedLyrics(JSON.parse(xhr.responseText)); } catch (e) {}
                });
            }
            return origSend.apply(this, arguments);
        };
    })();

    // ── Intercept fetch ───────────────────────────────────────────────────────
    (function patchFetch() {
        var origFetch = unsafeWindow.fetch;
        unsafeWindow.fetch = function () {
            var args   = arguments;
            var result = origFetch.apply(unsafeWindow, args);
            try {
                var url = args[0] ? args[0].toString() : '';
                if (url.indexOf('/next') !== -1 || url.indexOf('/browse') !== -1) {
                    result.then(function (resp) {
                        resp.clone().json().then(function (data) {
                            tryExtractTimedLyrics(data);
                        }).catch(function () {});
                    }).catch(function () {});
                }
            } catch (e) {}
            return result;
        };
    })();

    // ── Sync loop ─────────────────────────────────────────────────────────────
    function getVideo() { return document.querySelector('video'); }

    // Detect current video ID from URL param
    function currentVideoId() {
        try {
            var m = window.location.href.match(/[?&]v=([^&]+)/);
            return m ? m[1] : '';
        } catch (e) { return ''; }
    }

    function syncLoop() {
        // Clear if track changed
        var vid = currentVideoId();
        if (vid && vid !== lastVideoId) {
            lastVideoId = vid;
            clear();
        }

        // ── Mode A: we have timed lyrics from API ─────────────────────────────
        var video = getVideo();
        if (lyricsLines.length > 0 && video) {
            var ms     = video.currentTime * 1000;
            var curIdx = -1;
            for (var i = 0; i < lyricsLines.length; i++) {
                if (ms >= lyricsLines[i].startTimeMs) curIdx = i;
                else break;
            }
            var main = curIdx >= 0 ? lyricsLines[curIdx].words : '';
            var upc  = (curIdx + 1 < lyricsLines.length) ? lyricsLines[curIdx + 1].words : '';
            send(main, upc);
            return;
        }

        // ── Mode B: DOM scraping — active lyric line highlighted by YTM ───────
        // YTM marks the current lyric line with data-is-focused / .active class
        var activeEl =
            document.querySelector('.ytmusic-player-lyrics-renderer [focused]') ||
            document.querySelector('.ytmusic-player-lyrics-renderer .active') ||
            document.querySelector('[class*="lyricsLine"][class*="active"]') ||
            document.querySelector('[data-is-focused="true"]');

        if (activeEl) {
            var mainText = activeEl.textContent.trim();
            var nextEl   = activeEl.nextElementSibling;
            var upcText  = nextEl ? nextEl.textContent.trim() : '';
            send(mainText, upcText);
            return;
        }

        // ── Mode C: read static lyrics panel (no timing — shows whatever's open)
        var lyricsPanel = document.querySelector('.ytmusic-description-shelf-renderer');
        if (lyricsPanel) {
            // Static lyrics — just clear overlay (we can't sync position)
            send('', '');
            return;
        }

        send('', '');
    }

    // ── Start ─────────────────────────────────────────────────────────────────
    setInterval(syncLoop, POLL_MS);

    // Clear when navigating away from a track
    window.addEventListener('popstate', function () {
        if (!window.location.href.includes('?v=')) clear();
    });

})();

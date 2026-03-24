// ==UserScript==
// @name         LyricsOverlay Bridge — Spotify Web
// @namespace    lyricsoverlay.bridge
// @version      1.2
// @description  Intercepts Spotify lyrics API and sends synced lines to LyricsOverlay
// @author       you
// @match        https://open.spotify.com/*
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
    // Each line: { startTimeMs: Number, words: String }
    var lyricsLines  = [];
    var lastMain     = null;
    var lastUpc      = null;
    var lastTitle    = '';

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

    // ── Parse Spotify lyrics JSON ─────────────────────────────────────────────
    // Spotify color-lyrics API response shape:
    // { lyrics: { lines: [{ startTimeMs: "1234", words: "..." }] } }
    // Some tracks have syncType "LINE_SYNCED" or "UNSYNCED".
    function parseLyricsData(data) {
        try {
            var lyrics = data.lyrics || data;
            var lines  = lyrics.lines;
            if (!lines || !lines.length) return;

            var parsed = [];
            for (var i = 0; i < lines.length; i++) {
                var w = (lines[i].words || '').trim();
                // Skip musical note placeholders
                if (!w || w === '\u266a' || w === '...' ) continue;
                parsed.push({
                    startTimeMs: parseInt(lines[i].startTimeMs || 0, 10),
                    words: w
                });
            }
            if (parsed.length > 0) lyricsLines = parsed;
        } catch (e) {}
    }

    // ── Intercept fetch — catch calls to spclient / lyrics endpoints ──────────
    (function patchFetch() {
        var origFetch = unsafeWindow.fetch;
        unsafeWindow.fetch = function () {
            var args   = arguments;
            var result = origFetch.apply(unsafeWindow, args);

            try {
                var url = args[0] ? args[0].toString() : '';
                // Spotify lyrics endpoints (may change — this covers current known ones)
                if (url.indexOf('color-lyrics') !== -1 ||
                    url.indexOf('/lyrics')       !== -1 ||
                    url.indexOf('spclient')      !== -1 && url.indexOf('lyric') !== -1) {

                    result.then(function (resp) {
                        resp.clone().json().then(parseLyricsData).catch(function () {});
                    }).catch(function () {});
                }
            } catch (e) {}

            return result;
        };
    })();

    // Spotify also uses XHR in some internal components
    (function patchXHR() {
        var origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        var origSend = unsafeWindow.XMLHttpRequest.prototype.send;

        unsafeWindow.XMLHttpRequest.prototype.open = function (method, url) {
            this._sp_url = (typeof url === 'string') ? url : '';
            return origOpen.apply(this, arguments);
        };

        unsafeWindow.XMLHttpRequest.prototype.send = function (body) {
            var xhr = this;
            if (xhr._sp_url && (xhr._sp_url.indexOf('color-lyrics') !== -1 ||
                                  xhr._sp_url.indexOf('lyric') !== -1)) {
                xhr.addEventListener('load', function () {
                    try { parseLyricsData(JSON.parse(xhr.responseText)); } catch (e) {}
                });
            }
            return origSend.apply(this, arguments);
        };
    })();

    // ── Sync loop ─────────────────────────────────────────────────────────────
    function getAudio() {
        return document.querySelector('audio');
    }

    function syncLoop() {
        // Detect track change by watching the now-playing title
        var titleEl = document.querySelector('[data-testid="now-playing-widget"] a[data-testid="context-item-link"]') ||
                      document.querySelector('[data-testid="nowplaying-track-link"]') ||
                      document.querySelector('.encore-text[data-testid="nowplaying-track-link"]');
        var title = titleEl ? titleEl.textContent.trim() : '';
        if (title && title !== lastTitle) {
            lastTitle   = title;
            lyricsLines = [];   // clear stale lyrics — new ones will arrive via fetch intercept
            lastMain    = null;
            lastUpc     = null;
        }

        var audio = getAudio();
        if (!audio || lyricsLines.length === 0) { send('', ''); return; }

        var ms     = audio.currentTime * 1000;
        var curIdx = -1;

        // Find the last line whose startTimeMs <= current position
        for (var i = 0; i < lyricsLines.length; i++) {
            if (ms >= lyricsLines[i].startTimeMs) curIdx = i;
            else break;
        }

        var main = curIdx >= 0 ? lyricsLines[curIdx].words : '';
        var upc  = (curIdx + 1 < lyricsLines.length) ? lyricsLines[curIdx + 1].words : '';

        send(main, upc);
    }

    // ── Start polling after page is interactive ───────────────────────────────
    function start() { setInterval(syncLoop, POLL_MS); }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start);
    else
        start();

})();

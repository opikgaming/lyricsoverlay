// ==UserScript==
// @name         LyricsOverlay Bridge — UNIVERSAL (YT & YTM) v10
// @namespace    lyricsoverlay.bridge
// @version      10.0
// @description  Universal bridge for LyricsOverlay App
// @author       Topik and his wife (Gemini AI)
// @match        https://www.youtube.com/watch*
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      localhost
// @connect      lrclib.net
// @connect      translate.googleapis.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PORT = 7331;
    const POLL_MS = 100;

    // ─── SETTINGS ────────────────────────────────────────────────────────────
    let settings = {
        displayMode:   GM_getValue('displayMode',   'all'), // 'all' | 'top'
        primarySource: GM_getValue('primarySource', 'legato'),  // 'yt' | 'lrclib' | 'legato' | 'cubey'
        romajiMode:    GM_getValue('romajiMode',    false)
    };

    // ─── CACHES ───────────────────────────────────────────────────────────────
    let ytLyricsCache  = [];
    let lrcLyricsCache = [];
    let legatoCache    = [];
    let cubeyCache     = [];
    let activeLyrics   = [];

    let currentVideoId    = '';
    let lastMain          = null;
    let lastUpc           = null;
    let isProcessingRomaji = false;
    let isTransitioning    = false;

    // ─── MENUS ────────────────────────────────────────────────────────────────
    let menus = {};
    function updateMenus() {
        Object.values(menus).forEach(id => GM_unregisterMenuCommand(id));

        menus.source = GM_registerMenuCommand(
            `🔄 Source: ${settings.primarySource.toUpperCase()}`, () => {
                const sources = ['yt', 'lrclib', 'legato', 'cubey'];
                const idx = sources.indexOf(settings.primarySource);
                settings.primarySource = sources[(idx + 1) % sources.length];
                GM_setValue('primarySource', settings.primarySource);
                applyPreferredSource();
                updateMenus();
            }
        );

        menus.romaji = GM_registerMenuCommand(
            settings.romajiMode ? '🌸 Romaji: ON' : '🌸 Romaji: OFF', () => {
                settings.romajiMode = !settings.romajiMode;
                GM_setValue('romajiMode', settings.romajiMode);
                applyPreferredSource();
                updateMenus();
            }
        );

        menus.display = GM_registerMenuCommand(
            settings.displayMode === 'all' ? '📏 Mode: Tampilkan Semua' : '📏 Mode: Baris Atas Saja', () => {
                settings.displayMode = settings.displayMode === 'all' ? 'top' : 'all';
                GM_setValue('displayMode', settings.displayMode);
                updateMenus();
            }
        );
    }
    updateMenus();

    // ─── API SENDER ───────────────────────────────────────────────────────────
    // FIX: endpoint is /subtitle, payload uses 'upcoming' (not 'upc'), matching C# server
    function sendSubtitle(main, upcoming) {
        if (main === lastMain && upcoming === lastUpc) return;
        lastMain = main;
        lastUpc  = upcoming;
        GM_xmlhttpRequest({
            method:  'POST',
            url:     `http://localhost:${PORT}/subtitle`,
            headers: { 'Content-Type': 'application/json' },
            data:    JSON.stringify({ main, upcoming }),
            onerror: () => {}
        });
    }

    function sendClear() {
        lastMain = null;
        lastUpc  = null;
        GM_xmlhttpRequest({
            method:  'POST',
            url:     `http://localhost:${PORT}/clear`,
            onerror: () => {}
        });
    }

    // ─── PARSERS ──────────────────────────────────────────────────────────────
    function parseLRC(lrcText) {
        if (!lrcText || typeof lrcText !== 'string') return [];
        const lines        = lrcText.split('\n');
        const parsed       = [];
        const timeTagRegex = /\[(\d{2,}):(\d{2})\.(\d{1,3})\]/g;
        const wordTagRegex = /<\d{2}:\d{2}\.\d{2,3}>/g;

        for (const line of lines) {
            let m; const times = []; timeTagRegex.lastIndex = 0;
            while ((m = timeTagRegex.exec(line)) !== null) {
                times.push(parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, '0')));
            }
            if (times.length > 0) {
                const text = line.replace(timeTagRegex, '').replace(wordTagRegex, '').trim();
                if (text) times.forEach(t => parsed.push({ startTimeMs: t, durationMs: 0, text }));
            }
        }
        parsed.sort((a, b) => a.startTimeMs - b.startTimeMs);
        for (let i = 0; i < parsed.length - 1; i++) {
            parsed[i].durationMs = parsed[i + 1].startTimeMs - parsed[i].startTimeMs;
        }
        if (parsed.length > 0) parsed[parsed.length - 1].durationMs = 5000;
        return parsed;
    }

    function parseTTML(ttmlText) {
        if (!ttmlText || typeof ttmlText !== 'string') return [];
        const parser    = new DOMParser();
        const doc       = parser.parseFromString(ttmlText, 'text/xml');
        const parsed    = [];
        const romajiMap = {};

        for (const node of doc.getElementsByTagName('transliteration')) {
            const lang = node.getAttribute('xml:lang');
            if (lang && lang.includes('-Latn')) {
                for (const t of node.getElementsByTagName('text')) {
                    const key = t.getAttribute('for');
                    if (key) romajiMap[key] = t.textContent.replace(/\s+/g, ' ').trim();
                }
                break;
            }
        }

        for (const p of doc.getElementsByTagName('p')) {
            const beginStr = p.getAttribute('begin');
            const key      = p.getAttribute('itunes:key') || p.getAttribute('id');
            const text     = p.textContent.replace(/\s+/g, ' ').trim();

            if (beginStr && text) {
                const parts = beginStr.split(':');
                let ms = 0;
                if (parts.length === 3)      ms = parseInt(parts[0]) * 3600000 + parseInt(parts[1]) * 60000 + parseFloat(parts[2]) * 1000;
                else if (parts.length === 2) ms = parseInt(parts[0]) * 60000 + parseFloat(parts[1]) * 1000;
                else                         ms = parseFloat(parts[0]) * 1000;

                if (!isNaN(ms)) {
                    parsed.push({
                        startTimeMs: Math.round(ms), durationMs: 0, text,
                        romajiText: key && romajiMap[key] ? romajiMap[key] : null
                    });
                }
            }
        }
        parsed.sort((a, b) => a.startTimeMs - b.startTimeMs);
        for (let i = 0; i < parsed.length - 1; i++) {
            parsed[i].durationMs = parsed[i + 1].startTimeMs - parsed[i].startTimeMs;
        }
        if (parsed.length > 0) parsed[parsed.length - 1].durationMs = 5000;
        return parsed;
    }

    // ─── YT CAPTION EVENT NORMALIZER (from v7) ───────────────────────────────
    // FIX: v9.9 skipped this, causing dDurationMs = 0 → findIndex always fails
    function normalizeYTEvents(rawEvents) {
        if (!rawEvents) return [];
        const valid = rawEvents.filter(ev => ev.segs && ev.segs.some(s => s.utf8 && s.utf8.trim()));
        valid.sort((a, b) => (a.tStartMs || 0) - (b.tStartMs || 0));

        for (let i = 1; i < valid.length; i++) {
            const prev   = valid[i - 1];
            const curr   = valid[i];
            const pStart = prev.tStartMs || 0;
            const cStart = curr.tStartMs || 0;
            const pEnd   = pStart + (prev.dDurationMs || 0);
            const cEnd   = cStart + (curr.dDurationMs || 0);

            if (Math.abs(cStart - pStart) <= 150) {
                const minS = Math.min(pStart, cStart);
                prev.tStartMs = minS; prev.dDurationMs = pEnd - minS;
                curr.tStartMs = minS; curr.dDurationMs = cEnd - minS;
            }
        }
        return valid;
    }

    // ─── FETCHERS ─────────────────────────────────────────────────────────────
    const LANG_PRIORITY = ['ie', 'id', 'en', 'ja', 'en-us', 'en-gb'];

    function extractYTCaptions() {
        const player = document.querySelector('#movie_player');
        if (!player || typeof player.getPlayerResponse !== 'function') return;

        try {
            const pr     = player.getPlayerResponse();
            const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!tracks || tracks.length === 0) return;

            // Smart language selection from v7
            let bestTrack    = null;
            let bestPriority = 999;
            for (const track of tracks) {
                const langCode  = (track.languageCode || '').toLowerCase();
                const isAuto    = track.kind === 'asr' || (track.vss_id && track.vss_id.startsWith('a.'));
                let priority    = LANG_PRIORITY.indexOf(langCode);
                if (priority === -1) priority = 100;
                if (isAuto) priority += 500;
                if (priority < bestPriority) { bestPriority = priority; bestTrack = track; }
            }
            if (!bestTrack || !bestTrack.baseUrl) return;

            GM_xmlhttpRequest({
                method:  'GET',
                url:     bestTrack.baseUrl.replace(/&fmt=[^&]*/g, '') + '&fmt=json3',
                onload:  (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (!data || !data.events) return;

                        const normalized = normalizeYTEvents(data.events);
                        const mapped = normalized.map(ev => ({
                            startTimeMs: ev.tStartMs || 0,
                            durationMs:  ev.dDurationMs || 0,
                            text:        ev.segs.map(s => s.utf8 || '').join('').trim()
                        })).filter(l => l.text);

                        // Recalculate zero durations from next line's start
                        for (let i = 0; i < mapped.length - 1; i++) {
                            if (!mapped[i].durationMs) {
                                mapped[i].durationMs = mapped[i + 1].startTimeMs - mapped[i].startTimeMs;
                            }
                        }
                        if (mapped.length > 0 && !mapped[mapped.length - 1].durationMs) {
                            mapped[mapped.length - 1].durationMs = 5000;
                        }

                        ytLyricsCache = mapped;
                        applyPreferredSource();
                    } catch (e) {}
                }
            });
        } catch (e) {}
    }

    function fetchExternalSources() {
        let title  = '';
        let artist = '';

        if (navigator.mediaSession && navigator.mediaSession.metadata) {
            title  = navigator.mediaSession.metadata.title  || '';
            artist = navigator.mediaSession.metadata.artist || '';
        } else {
            title = document.title
                .replace(' - YouTube Music', '')
                .replace(' - YouTube', '');
        }
        if (!title) return;

        const cleanTitle  = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, '').split('-')[0].trim();
        const cleanArtist = artist.replace(/ - Topic$/, '').trim();
        const qStr        = `${cleanTitle} ${cleanArtist}`.trim();

        // ── LRCLIB ──
        GM_xmlhttpRequest({
            method:  'GET',
            url:     `https://lrclib.net/api/search?q=${encodeURIComponent(qStr)}`,
            onload:  (res) => {
                try {
                    const data = JSON.parse(res.responseText);
                    if (data && data.length > 0 && data[0].syncedLyrics) {
                        lrcLyricsCache = parseLRC(data[0].syncedLyrics);
                        applyPreferredSource();
                    }
                } catch (e) {}
            }
        });

        // ── LEGATO — uncomment & fill in your API URL ──
        /*
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://YOUR_LEGATO_API/search?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`,
            onload: (res) => {
                try {
                    // If TTML: legatoCache = parseTTML(res.responseText);
                    // If LRC:  legatoCache = parseLRC(res.responseText);
                    applyPreferredSource();
                } catch (e) {}
            }
        });
        */

        // ── CUBEY — uncomment & fill in your API URL ──
        /*
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://YOUR_CUBEY_API/search?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`,
            onload: (res) => {
                try {
                    // If LRC:  cubeyCache = parseLRC(res.responseText);
                    applyPreferredSource();
                } catch (e) {}
            }
        });
        */
    }

    // ─── PRIORITY LOGIC ───────────────────────────────────────────────────────
    function applyPreferredSource() {
        const sources = { yt: ytLyricsCache, lrclib: lrcLyricsCache, legato: legatoCache, cubey: cubeyCache };
        let chosen = [];

        if (sources[settings.primarySource]?.length > 0) {
            chosen = sources[settings.primarySource];
        } else {
            chosen = cubeyCache.length  > 0 ? cubeyCache  :
                     legatoCache.length > 0 ? legatoCache :
                     lrcLyricsCache.length > 0 ? lrcLyricsCache :
                     ytLyricsCache.length  > 0 ? ytLyricsCache  : [];
        }

        if (chosen.length === 0) { activeLyrics = []; isProcessingRomaji = false; return; }

        if (settings.romajiMode) {
            if (chosen.some(l => l.romajiText)) {
                activeLyrics = chosen.map(l => ({ startTimeMs: l.startTimeMs, durationMs: l.durationMs, text: l.romajiText || l.text }));
                isProcessingRomaji = false;
            } else {
                isProcessingRomaji = true;
                applyRomaji(JSON.parse(JSON.stringify(chosen))).then(res => {
                    activeLyrics = res;
                    isProcessingRomaji = false;
                });
            }
        } else {
            activeLyrics = chosen.map(l => ({ startTimeMs: l.startTimeMs, durationMs: l.durationMs, text: l.text }));
            isProcessingRomaji = false;
        }
    }

    // ─── ROMAJI (batch translate) ─────────────────────────────────────────────
    async function applyRomaji(lyricsArray) {
        const fullText = lyricsArray.map(l => l.text).join(' ');
        let sl = '';
        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(fullText))  sl = 'ja';
        else if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(fullText)) sl = 'ko';
        else if (/[\u4E00-\u9FAF]/.test(fullText))           sl = 'zh-CN';
        if (!sl) return lyricsArray;

        const BATCH_SEP = '\n\n;\n\n';
        const results   = JSON.parse(JSON.stringify(lyricsArray));
        const toProcess = [];

        results.forEach((item, index) => {
            const t = item.text.trim();
            if (t && t !== '♪') toProcess.push({ index, text: t });
        });
        if (toProcess.length === 0) return results;

        const preprocess = (txt) => sl !== 'ja' ? txt :
            txt.replace(/君/g, 'kimi ').replace(/方/g, 'hou ').replace(/の中/g, 'no naka ').replace(/側/g, 'gawa ');

        const baseUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=en&dt=t&dt=rm&q=`;
        const chunks  = [];
        let curChunk  = [], curLen = 0;

        for (const item of toProcess) {
            const safe   = preprocess(item.text);
            const addLen = (curChunk.length > 0 ? encodeURIComponent(BATCH_SEP).length : 0) + encodeURIComponent(safe).length;
            if (curChunk.length > 0 && baseUrl.length + curLen + addLen > 14000) {
                chunks.push(curChunk); curChunk = []; curLen = 0;
            }
            curChunk.push({ ...item, preprocessedText: safe });
            curLen += addLen;
        }
        if (curChunk.length > 0) chunks.push(curChunk);

        return new Promise((resolve) => {
            let done = 0;
            chunks.forEach(chunk => {
                const url = baseUrl + encodeURIComponent(chunk.map(i => i.preprocessedText).join(BATCH_SEP));
                GM_xmlhttpRequest({
                    method:  'GET',
                    url:     url,
                    onload:  (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data && data[0]) {
                                let fullOut = '';
                                for (const part of data[0]) { if (part) fullOut += (part[3] || part[2] || ''); }

                                let linesOut = fullOut.split(BATCH_SEP);
                                if (linesOut.length < chunk.length) {
                                    const semi = fullOut.split(';').filter(l => l.trim());
                                    linesOut = semi.length === chunk.length ? semi
                                             : fullOut.split(/\r?\n/).filter(l => l.trim());
                                }
                                chunk.forEach((item, i) => { if (linesOut[i]) results[item.index].text = linesOut[i].trim(); });
                            }
                        } catch (e) {}
                        if (++done === chunks.length) resolve(results);
                    },
                    onerror: () => { if (++done === chunks.length) resolve(results); }
                });
            });
        });
    }

    // ─── SYNC ENGINE ──────────────────────────────────────────────────────────
    // FIX: removed document.hasFocus() gate — sync must run regardless of focus
    function syncLoop() {
        if (isProcessingRomaji || isTransitioning) return;

        const videoEl = document.querySelector('video');
        const ms      = videoEl ? videoEl.currentTime * 1000 : 0;

        let mainOut = '';
        let upcOut  = '';

        if (activeLyrics.length > 0) {
            const idx = activeLyrics.findIndex(
                ev => ms >= ev.startTimeMs && ms < (ev.startTimeMs + ev.durationMs)
            );
            if (idx !== -1) {
                const cur  = activeLyrics[idx].text;
                mainOut    = settings.displayMode === 'all' ? cur : cur.split('\n')[0].trim();
                if (idx + 1 < activeLyrics.length) {
                    const nxt = activeLyrics[idx + 1].text;
                    upcOut    = settings.displayMode === 'all' ? nxt : nxt.split('\n')[0].trim();
                }
            } else if (activeLyrics[0] && ms < activeLyrics[0].startTimeMs) {
                // Before the first line — show it as upcoming
                const first = activeLyrics[0].text;
                upcOut = settings.displayMode === 'all' ? first : first.split('\n')[0].trim();
            }
        } else {
            // DOM fallback for YTM built-in lyrics panel
            const activeEl =
                document.querySelector('.ytmusic-player-lyrics-renderer [focused]') ||
                document.querySelector('.ytmusic-player-lyrics-renderer .active')   ||
                document.querySelector('[class*="lyricsLine"][class*="active"]')    ||
                document.querySelector('[data-is-focused="true"]');
            if (activeEl) {
                const nextEl = activeEl.nextElementSibling;
                mainOut = activeEl.textContent.trim();
                upcOut  = nextEl ? nextEl.textContent.trim() : '';
            }
        }

        sendSubtitle(mainOut, upcOut);
    }

    // ─── SONG CHANGE DETECTOR ─────────────────────────────────────────────────
    // FIX: use URL video ID (reliable) instead of mediaSession title (may be unset)
    function getVideoId() {
        try {
            const m = window.location.href.match(/[?&]v=([^&]+)/);
            return m ? m[1] : '';
        } catch (e) { return ''; }
    }

    function checkSongChange() {
        const vid = getVideoId();
        if (!vid || vid === currentVideoId) return;

        currentVideoId = vid;
        isTransitioning = true;
        ytLyricsCache = []; lrcLyricsCache = []; legatoCache = []; cubeyCache = []; activeLyrics = [];
        sendClear();

        setTimeout(() => {
            isTransitioning = false;
            extractYTCaptions();
            fetchExternalSources();
        }, 1500);
    }

    // ─── START ────────────────────────────────────────────────────────────────
    setInterval(checkSongChange, 500);
    setInterval(syncLoop, POLL_MS);

    window.addEventListener('popstate', () => {
        if (!window.location.href.includes('?v=')) sendClear();
    });

})();
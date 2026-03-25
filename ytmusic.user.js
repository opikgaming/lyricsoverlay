// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube Music (Ultimate Edition)
// @namespace    lyricsoverlay.bridge
// @version      5.0
// @description  Dynamic Priority (LRCLIB <-> YT Captions) with Fallback & Language Config
// @author       you & your lovely AI ✨
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      lrclib.net
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const PORT = 7331;
    const POLL_MS = 100;

    // 🌐 KASTA BAHASA (Gampang diedit!)
    const LANG_PRIORITY = ['ie', 'id', 'en', 'ja', 'en-us', 'en-gb'];

    let lyricsLines = [];
    let lastMain = null;
    let lastUpc = null;
    let currentVideoId = '';

    // ── STATE & TOGGLES ──────────────────────────────────────────────────────
    let showAllLines = GM_getValue('showAllLines', true);
    let primarySource = GM_getValue('primarySource', 'LRCLIB'); // 'LRCLIB' atau 'YT'

    let menuIdMode = null;
    let menuIdSource = null;

    function toggleMode() {
        showAllLines = !showAllLines;
        GM_setValue('showAllLines', showAllLines);
        updateMenu();
        lastMain = null; // paksa update
    }

    function toggleSourcePriority() {
        primarySource = primarySource === 'LRCLIB' ? 'YT' : 'LRCLIB';
        GM_setValue('primarySource', primarySource);
        updateMenu();
        clear(); // Bersihin lirik yang sekarang
        fetchLyricsOrCaptions(); // Langsung fetch ulang pake prioritas baru! ✨
    }

    function updateMenu() {
        if (menuIdMode !== null) GM_unregisterMenuCommand(menuIdMode);
        if (menuIdSource !== null) GM_unregisterMenuCommand(menuIdSource);

        let labelSource = primarySource === 'LRCLIB' ? "⭐ Prioritas: LRCLIB -> YT Captions" : "⭐ Prioritas: YT Captions -> LRCLIB";
        menuIdSource = GM_registerMenuCommand(labelSource, toggleSourcePriority);

        let labelMode = showAllLines ? "🔄 Mode YT Sub: Tampilkan SEMUA Baris" : "🔄 Mode YT Sub: Baris ATAS Saja";
        menuIdMode = GM_registerMenuCommand(labelMode, toggleMode);
    }
    updateMenu();

    window.addEventListener('keydown', function(e) {
        if (e.altKey && e.key.toLowerCase() === 'l') toggleMode();
        if (e.altKey && e.key.toLowerCase() === 'p') toggleSourcePriority(); // Shortcut baru! 🎯
    });

    // ── NETWORK HELPERS ──────────────────────────────────────────────────────
    function send(main, upcoming) {
        if (main === lastMain && upcoming === lastUpc) return;
        lastMain = main; lastUpc = upcoming;
        GM_xmlhttpRequest({
            method: 'POST',
            url: `http://localhost:${PORT}/subtitle`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ main, upcoming }),
            onerror: () => {}
        });
    }

    function clear() {
        lastMain = null; lastUpc = null; lyricsLines = [];
        GM_xmlhttpRequest({ method: 'POST', url: `http://localhost:${PORT}/clear`, onerror: () => {} });
    }

    // ── LYRICS PARSERS ───────────────────────────────────────────────────────
    function parseLRC(lrcText) {
        const lines = lrcText.split('\n');
        const parsed = [];
        const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(regex);
            if (match) {
                let min = parseInt(match[1]), sec = parseInt(match[2]), ms = parseInt(match[3]);
                if (match[3].length === 2) ms *= 10;
                let text = match[4].trim();
                if (text) parsed.push({ startTimeMs: (min * 60 * 1000) + (sec * 1000) + ms, words: text, source: 'lrc' });
            }
        }
        return parsed;
    }

    function normalizeEvents(rawEvents) {
        if (!rawEvents) return [];
        let valid = rawEvents.filter(ev => ev.segs && ev.segs.some(s => s.utf8 && s.utf8.trim().length > 0));
        valid.sort((a, b) => (a.tStartMs || 0) - (b.tStartMs || 0));

        for (let i = 1; i < valid.length; i++) {
            let prev = valid[i-1], curr = valid[i];
            let pStart = prev.tStartMs || 0, cStart = curr.tStartMs || 0;
            let pEnd = pStart + (prev.dDurationMs || 0), cEnd = cStart + (curr.dDurationMs || 0);

            if (Math.abs(cStart - pStart) <= 150) {
                let minS = Math.min(pStart, cStart);
                prev.tStartMs = minS; curr.tStartMs = minS;
                prev.dDurationMs = pEnd - minS; curr.dDurationMs = cEnd - minS;
            }
            if (Math.abs(cEnd - pEnd) <= 150) {
                let maxE = Math.max(pEnd, cEnd);
                prev.dDurationMs = maxE - prev.tStartMs; curr.dDurationMs = maxE - curr.tStartMs;
            }
        }
        return valid;
    }

    // ── EXTERNAL PROVIDERS ───────────────────────────────────────────────────
    function fetchFromLRCLIB(title, artist) {
        return new Promise((resolve) => {
            let cleanTitle = title.replace(/(\(|\[).*(\)|\])/g, '').trim();
            let cleanArtist = artist.replace(/ - Topic$/, '').trim();
            let searchQ = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);

            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://lrclib.net/api/search?q=${searchQ}`,
                onload: (res) => {
                    try {
                        let data = JSON.parse(res.responseText);
                        let track = data.find(t => t.syncedLyrics);
                        if (track && track.syncedLyrics) resolve(parseLRC(track.syncedLyrics));
                        else resolve(null);
                    } catch (e) { resolve(null); }
                },
                onerror: () => resolve(null)
            });
        });
    }

    function fetchFromYTCaptions() {
        return new Promise((resolve) => {
            let player = document.querySelector('#movie_player');
            if (!player || typeof player.getPlayerResponse !== 'function') return resolve(null);

            let pr = player.getPlayerResponse();
            let ctl = pr?.captions?.playerCaptionsTracklistRenderer;
            if (!ctl || !ctl.captionTracks || ctl.captionTracks.length === 0) return resolve(null);

            let tracks = ctl.captionTracks;
            let bestTrack = null;
            let bestPriorityIdx = 999;

            for (let track of tracks) {
                let langCode = track.languageCode.toLowerCase();
                let isAuto = track.kind === 'asr' || (track.vss_id && track.vss_id.startsWith('a.'));

                let priorityIdx = LANG_PRIORITY.indexOf(langCode);
                if (priorityIdx === -1) priorityIdx = 100;
                if (isAuto) priorityIdx += 500;

                if (priorityIdx < bestPriorityIdx) {
                    bestPriorityIdx = priorityIdx;
                    bestTrack = track;
                }
            }

            if (!bestTrack || !bestTrack.baseUrl) return resolve(null);

            console.log(`[LyricsBridge] YT Captions milih bahasa: ${bestTrack.name?.simpleText || bestTrack.languageCode} ${bestTrack.kind === 'asr' ? '(Auto-generated 🤖)' : '(Manual ✨)'}`);

            let trackUrl = bestTrack.baseUrl.replace(/&fmt=[^&]*/g, '').replace(/\?fmt=[^&]*/g, '') + '&fmt=json3';

            GM_xmlhttpRequest({
                method: 'GET', url: trackUrl,
                onload: (resp) => {
                    try {
                        let data = JSON.parse(resp.responseText);
                        if (data && data.events) {
                            let normalized = normalizeEvents(data.events);
                            let parsed = [];
                            for(let ev of normalized) {
                                let texts = ev.segs ? ev.segs.map(s => s.utf8 || '').join('').trim() : '';
                                if(texts) {
                                    parsed.push({
                                        startTimeMs: ev.tStartMs || 0,
                                        endTimeMs: (ev.tStartMs || 0) + (ev.dDurationMs || 0),
                                        words: texts,
                                        source: 'yt'
                                    });
                                }
                            }
                            resolve(parsed);
                        } else resolve(null);
                    } catch(e) { resolve(null); }
                },
                onerror: () => resolve(null)
            });
        });
    }

    async function fetchLyricsOrCaptions() {
        if (!navigator.mediaSession || !navigator.mediaSession.metadata) return;

        let title = navigator.mediaSession.metadata.title;
        let artist = navigator.mediaSession.metadata.artist;

        console.log(`[LyricsBridge] Nyari lirik buat: ${title} - ${artist}... 🔍 (Prioritas: ${primarySource})`);

        let result = null;

        if (primarySource === 'LRCLIB') {
            result = await fetchFromLRCLIB(title, artist);
            if (result && result.length > 0) {
                lyricsLines = result;
                console.log(`[LyricsBridge] Yeay! Ketemu lirik Synced dari LRCLIB! ✨`);
                return;
            }
            console.log(`[LyricsBridge] Lirik LRCLIB kosong. Fallback ke YouTube Captions... 👀`);
            result = await fetchFromYTCaptions();
            if (result && result.length > 0) {
                lyricsLines = result;
                console.log(`[LyricsBridge] Berhasil colong Subtitle YouTube! 🤌`);
                return;
            }
        } else {
            result = await fetchFromYTCaptions();
            if (result && result.length > 0) {
                lyricsLines = result;
                console.log(`[LyricsBridge] Berhasil colong Subtitle YouTube! 🤌`);
                return;
            }
            console.log(`[LyricsBridge] Subtitle YouTube kosong. Fallback ke LRCLIB... 👀`);
            result = await fetchFromLRCLIB(title, artist);
            if (result && result.length > 0) {
                lyricsLines = result;
                console.log(`[LyricsBridge] Yeay! Ketemu lirik Synced dari LRCLIB! ✨`);
                return;
            }
        }

        console.log(`[LyricsBridge] Yah, dua-duanya zonk 😢`);
    }

    // ── CORE LOGIC ───────────────────────────────────────────────────────────
    function getVideo() { return document.querySelector('video'); }
    function getUrlVideoId() {
        try { let m = window.location.href.match(/[?&]v=([^&]+)/); return m ? m[1] : ''; }
        catch (e) { return ''; }
    }

    function trackDetectorLoop() {
        let vid = getUrlVideoId();
        if (vid && vid !== currentVideoId) {
            currentVideoId = vid;
            clear();
            setTimeout(fetchLyricsOrCaptions, 1500);
        }
    }

    function evTextProcess(rawWords) {
        if (showAllLines) return rawWords;
        let blocks = rawWords.split('\n');
        return blocks.length > 1 ? blocks[blocks.length - 1].trim() : blocks[0].trim();
    }

    function syncLoop() {
        let video = getVideo();
        if (!video) { send('', ''); return; }

        let ms = video.currentTime * 1000;

        if (lyricsLines.length > 0) {
            let activeLines = [];
            let curIdx = -1;

            for (let i = 0; i < lyricsLines.length; i++) {
                let line = lyricsLines[i];
                if (ms >= line.startTimeMs) {
                    if (line.endTimeMs && ms >= line.endTimeMs) continue;
                    activeLines.push(line);
                    curIdx = i;
                } else {
                    break;
                }
            }

            let mainStr = '';
            if (activeLines.length > 0) {
                let isYT = activeLines[0].source === 'yt';
                if (isYT) {
                    let combinedWords = activeLines.map(l => l.words).join('\n');
                    mainStr = evTextProcess(combinedWords);
                } else {
                    mainStr = activeLines[activeLines.length - 1].words;
                }
            }

            let upcStr = '';
            if (curIdx >= 0 && curIdx + 1 < lyricsLines.length) {
                let nextLine = lyricsLines[curIdx + 1];
                upcStr = nextLine.source === 'yt' ? evTextProcess(nextLine.words) : nextLine.words;
            } else if (curIdx === -1 && lyricsLines.length > 0 && ms < lyricsLines[0].startTimeMs) {
                let firstLine = lyricsLines[0];
                upcStr = firstLine.source === 'yt' ? evTextProcess(firstLine.words) : firstLine.words;
            }

            send(mainStr, upcStr);
            return;
        }

        let activeEl = document.querySelector('.ytmusic-player-lyrics-renderer [focused]') ||
                       document.querySelector('.ytmusic-player-lyrics-renderer .active') ||
                       document.querySelector('[class*="lyricsLine"][class*="active"]') ||
                       document.querySelector('[data-is-focused="true"]');

        if (activeEl) {
            let nextEl = activeEl.nextElementSibling;
            send(activeEl.textContent.trim(), nextEl ? nextEl.textContent.trim() : '');
            return;
        }

        if (document.querySelector('.ytmusic-description-shelf-renderer')) { send('', ''); return; }
        send('', '');
    }

    setInterval(trackDetectorLoop, 500);
    setInterval(syncLoop, POLL_MS);

    window.addEventListener('popstate', function () {
        if (!window.location.href.includes('?v=')) clear();
    });

})();
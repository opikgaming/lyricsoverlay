// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube Music (Ultimate Edition v7)
// @namespace    lyricsoverlay.bridge
// @version      7.0
// @description  YT Captions First + Smart Batch Romaji Converter (BetterLyrics Method)
// @author       you, your lovely AI ✨, & your AI selingkuhan 😤
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      lrclib.net
// @connect      translate.googleapis.com
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const PORT = 7331;
    const POLL_MS = 100;

    // 🌐 KASTA BAHASA
    const LANG_PRIORITY = ['ie', 'id', 'en', 'ja', 'en-us', 'en-gb'];

    let lyricsLines = [];
    let lastMain = null;
    let lastUpc = null;
    let currentVideoId = '';

    // ── STATE & TOGGLES ──────────────────────────────────────────────────────
    let showAllLines = GM_getValue('showAllLines', true);
    let primarySource = GM_getValue('primarySource', 'YT'); // DEFAULT YTCaption
    let romajiMode = GM_getValue('romajiMode', false);

    let menuIdMode = null;
    let menuIdSource = null;
    let menuIdRomaji = null;

    function toggleMode() {
        showAllLines = !showAllLines;
        GM_setValue('showAllLines', showAllLines);
        updateMenu();
        lastMain = null;
    }

    function toggleSourcePriority() {
        primarySource = primarySource === 'LRCLIB' ? 'YT' : 'LRCLIB';
        GM_setValue('primarySource', primarySource);
        updateMenu();
        clear();
        fetchLyricsOrCaptions();
    }

    function toggleRomaji() {
        romajiMode = !romajiMode;
        GM_setValue('romajiMode', romajiMode);
        updateMenu();
        clear();
        fetchLyricsOrCaptions();
    }

    function updateMenu() {
        if (menuIdMode !== null) GM_unregisterMenuCommand(menuIdMode);
        if (menuIdSource !== null) GM_unregisterMenuCommand(menuIdSource);
        if (menuIdRomaji !== null) GM_unregisterMenuCommand(menuIdRomaji);

        let labelSource = primarySource === 'LRCLIB' ? "⭐ Prioritas: LRCLIB -> YT" : "⭐ Prioritas: YT -> LRCLIB";
        menuIdSource = GM_registerMenuCommand(labelSource, toggleSourcePriority);

        let labelRomaji = romajiMode ? "🪄 Mode Huruf: ✨ ROMAJI ✨" : "🪄 Mode Huruf: 🇯🇵 ASLI (JP)";
        menuIdRomaji = GM_registerMenuCommand(labelRomaji, toggleRomaji);

        let labelMode = showAllLines ? "🔄 Mode YT Sub: Tampilkan SEMUA Baris" : "🔄 Mode YT Sub: Baris ATAS Saja";
        menuIdMode = GM_registerMenuCommand(labelMode, toggleMode);
    }
    updateMenu();

    window.addEventListener('keydown', function(e) {
        if (e.altKey && e.key.toLowerCase() === 'l') toggleMode();
        if (e.altKey && e.key.toLowerCase() === 'p') toggleSourcePriority();
        if (e.altKey && e.key.toLowerCase() === 'r') toggleRomaji();
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

    // ── ROMAJI CONVERTER (BATCH SEPARATOR MAGIC) ─────────────────────────────
    function applyRomajiIfEnabled(linesArray) {
        return new Promise((resolve) => {
            if (!romajiMode || !linesArray || linesArray.length === 0) {
                return resolve(linesArray);
            }

            // Cek ada aksara jepang ga?
            const jpRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
            if (!linesArray.some(l => jpRegex.test(l.words))) {
                return resolve(linesArray);
            }

            console.log(`[LyricsBridge] Huruf Jepang terdeteksi! Menggunakan Trik Pemisah Sakti... 🪄`);

            const BATCH_SEPARATOR = "\n\n;\n\n";
            const MAX_URL_LENGTH = 14000;
            const results = [...linesArray]; // Copy dari array asli
            const toProcess = [];

            // Prep
            linesArray.forEach((item, index) => {
                const trimmed = (item.words || "").trim();
                if (!trimmed || trimmed === "♪") return;
                toProcess.push({ index, text: trimmed });
            });

            if (toProcess.length === 0) return resolve(results);

            // Chunking biar ga error URL Too Long
            const chunks = [];
            let currentChunk = [];
            let currentLength = 0;
            const baseUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&dt=rm&q=`;
            const sepEncoded = encodeURIComponent(BATCH_SEPARATOR);

            for (const item of toProcess) {
                const encoded = encodeURIComponent(item.text);
                const addedLength = (currentChunk.length > 0 ? sepEncoded.length : 0) + encoded.length;

                if (currentChunk.length > 0 && baseUrl.length + currentLength + addedLength > MAX_URL_LENGTH) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                    currentLength = 0;
                }
                currentChunk.push(item);
                currentLength += addedLength;
            }
            if (currentChunk.length > 0) chunks.push(currentChunk);

            // Tembak API per Chunk
            let done = 0;
            chunks.forEach(chunk => {
                const combinedText = chunk.map(i => i.text).join(BATCH_SEPARATOR);
                const url = baseUrl + encodeURIComponent(combinedText);

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            let fullText = "";

                            // Ekstrak romaji
                            if (data && data[0]) {
                                for (const part of data[0]) {
                                    if (!part) continue;
                                    const rm = part[3] || part[2] || ""; // Google naronya di index 2 atau 3
                                    fullText += rm;
                                }
                            }

                            // Belah balik liriknya
                            let linesOut = fullText.split(BATCH_SEPARATOR);

                            // Kalo Google ngeyel ngebuang BATCH_SEPARATOR, kita pake fallback spliter (;)
                            if (linesOut.length < chunk.length) {
                                const semi = fullText.split(";").filter(l => l.trim());
                                if (semi.length === chunk.length) {
                                    linesOut = semi;
                                } else {
                                    const nl = fullText.split(/\r?\n/).filter(l => l.trim());
                                    if (nl.length === chunk.length) linesOut = nl;
                                    else linesOut = []; // Nyerah, biarin kosong ntar di-fallback ke jepang
                                }
                            }

                            // Jahit ke objek aslinya
                            chunk.forEach((item, i) => {
                                const translated = linesOut[i]?.trim();
                                if (translated) {
                                    results[item.index] = { ...results[item.index], words: translated };
                                }
                            });
                        } catch (e) {
                            console.error("[LyricsBridge] Gagal ngebelah Romaji dari Google:", e);
                        }

                        done++;
                        if (done === chunks.length) resolve(results);
                    },
                    onerror: (err) => {
                        console.error("[LyricsBridge] API Romaji Error:", err);
                        done++;
                        if (done === chunks.length) resolve(results);
                    }
                });
            });
        });
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

        if (primarySource === 'YT') {
            result = await fetchFromYTCaptions();
            if (result && result.length > 0) {
                console.log(`[LyricsBridge] Berhasil colong Subtitle YouTube! 🤌`);
                lyricsLines = await applyRomajiIfEnabled(result);
                return;
            }
            console.log(`[LyricsBridge] Subtitle YouTube kosong. Fallback ke LRCLIB... 👀`);
            result = await fetchFromLRCLIB(title, artist);
            if (result && result.length > 0) {
                console.log(`[LyricsBridge] Yeay! Ketemu lirik Synced dari LRCLIB! ✨`);
                lyricsLines = await applyRomajiIfEnabled(result);
                return;
            }
        } else {
            result = await fetchFromLRCLIB(title, artist);
            if (result && result.length > 0) {
                console.log(`[LyricsBridge] Yeay! Ketemu lirik Synced dari LRCLIB! ✨`);
                lyricsLines = await applyRomajiIfEnabled(result);
                return;
            }
            console.log(`[LyricsBridge] Lirik LRCLIB kosong. Fallback ke YouTube Captions... 👀`);
            result = await fetchFromYTCaptions();
            if (result && result.length > 0) {
                console.log(`[LyricsBridge] Berhasil colong Subtitle YouTube! 🤌`);
                lyricsLines = await applyRomajiIfEnabled(result);
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
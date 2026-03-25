// ==UserScript==
// @name         LyricsOverlay Bridge — YouTube Music (External Fetcher)
// @namespace    lyricsoverlay.bridge
// @version      3.0
// @description  Sends YouTube Music synced lyrics to LyricsOverlay using Better Lyrics architecture
// @author       you & your lovely AI ✨
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      lrclib.net
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const PORT = 7331;
    const POLL_MS = 100;

    let lyricsLines = [];
    let lastMain = null;
    let lastUpc = null;
    let currentVideoId = '';
    let isFetching = false;

    // --- NETWORK HELPERS ---

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
        GM_xmlhttpRequest({
            method: 'POST',
            url: `http://localhost:${PORT}/clear`,
            onerror: () => {}
        });
    }

    // --- LYRICS PARSER ---

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
                if (text) parsed.push({ startTimeMs: (min * 60 * 1000) + (sec * 1000) + ms, words: text });
            }
        }
        return parsed;
    }

    // --- EXTERNAL PROVIDERS ---

    // Bisa ditambahin provider lain di sini nanti!
    function fetchFromLRCLIB(title, artist) {
        return new Promise((resolve, reject) => {
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
                        if (track && track.syncedLyrics) {
                            resolve(parseLRC(track.syncedLyrics));
                        } else {
                            resolve(null); // Gak nemu yang synced
                        }
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null) // Skip kalo error
            });
        });
    }

    async function fetchLyricsFromProviders() {
        if (!navigator.mediaSession || !navigator.mediaSession.metadata) return;

        isFetching = true;
        let title = navigator.mediaSession.metadata.title;
        let artist = navigator.mediaSession.metadata.artist;

        console.log(`[LyricsBridge] Mencari lirik untuk: ${title} - ${artist}... 🔍`);

        // Provider 1: LRCLIB (Kalo ada provider lain, tinggal di-chain pake fallback)
        let lrcResult = await fetchFromLRCLIB(title, artist);

        if (lrcResult && lrcResult.length > 0) {
            lyricsLines = lrcResult;
            console.log(`[LyricsBridge] Yeay! Ketemu ${lyricsLines.length} baris lirik dari LRCLIB! ✨`);
        } else {
            console.log(`[LyricsBridge] Yah, liriknya gak ketemu di provider mana pun 😢`);
        }

        isFetching = false;
    }

    // --- CORE LOGIC ---

    function getVideo() { return document.querySelector('video'); }
    function getUrlVideoId() {
        try { let m = window.location.href.match(/[?&]v=([^&]+)/); return m ? m[1] : ''; }
        catch (e) { return ''; }
    }

    // Loop khusus buat ngecek pergantian lagu (biar misah sama sync loop)
    function trackDetectorLoop() {
        let vid = getUrlVideoId();
        if (vid && vid !== currentVideoId) {
            currentVideoId = vid;
            clear();

            // Tunggu 1.5 detik biar MediaSession di-update sama YT Music sebelum nge-fetch
            setTimeout(() => {
                fetchLyricsFromProviders();
            }, 1500);
        }
    }

    // Loop super ringan yang cuma jalanin timeline
    function syncLoop() {
        let video = getVideo();
        if (!video) { send('', ''); return; }

        if (lyricsLines.length > 0) {
            let ms = video.currentTime * 1000;
            let curIdx = -1;

            for (let i = 0; i < lyricsLines.length; i++) {
                if (ms >= lyricsLines[i].startTimeMs) curIdx = i;
                else break;
            }

            let mainStr = curIdx >= 0 ? lyricsLines[curIdx].words : '';
            let upcStr = (curIdx + 1 < lyricsLines.length) ? lyricsLines[curIdx + 1].words : '';

            send(mainStr, upcStr);
            return;
        }

        // DOM Fallback (Kalo lirik di eksternal kosong, minimal baca dari DOM kalo YT kebetulan nyediain)
        let activeEl = document.querySelector('.ytmusic-player-lyrics-renderer [focused]') ||
                       document.querySelector('.ytmusic-player-lyrics-renderer .active') ||
                       document.querySelector('[class*="lyricsLine"][class*="active"]') ||
                       document.querySelector('[data-is-focused="true"]');

        if (activeEl) {
            let nextEl = activeEl.nextElementSibling;
            send(activeEl.textContent.trim(), nextEl ? nextEl.textContent.trim() : '');
            return;
        }

        // Kalo lagi di description shelf / kosong
        if (document.querySelector('.ytmusic-description-shelf-renderer')) { send('', ''); return; }
        send('', '');
    }

    // Jalankan kedua loop
    setInterval(trackDetectorLoop, 500); // Ngecek lagu ganti tiap 500ms aja, gak perlu ngebut
    setInterval(syncLoop, POLL_MS);      // Nyocokin lirik tetep tiap 100ms

    window.addEventListener('popstate', function () {
        if (!window.location.href.includes('?v=')) clear();
    });

})();
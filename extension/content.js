// --- CONFIGURATION & STATE ---
const POLL_MS = 100;
let settings = {
    displayMode: 'all',
    primarySource: 'yt',
    romajiMode: false
};

let ytLyricsCache = [];
let lrcLyricsCache = [];
let activeLyrics = [];

let currentVideoId = '';
let lastMain = null;
let lastUpc = null;

chrome.storage.local.get(settings, (res) => { settings = res; });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "settingsUpdated") {
        settings = request.settings;
        clearApp();
        applyPreferredSource();
    }
});

function sendToApp(main, upcoming) {
    if (main === lastMain && upcoming === lastUpc) return;
    lastMain = main;
    lastUpc = upcoming;
    chrome.runtime.sendMessage({
        action: 'sendSubtitle',
        payload: { main, upcoming }
    });
}

function clearApp() {
    lastMain = null;
    lastUpc = null;
    chrome.runtime.sendMessage({ action: 'clearSubtitle' });
}

// --- RECEIVE DATA FROM INJECT.JS ---
window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'LYRICS_BRIDGE_YT') return;
    processYTCaptions(event.data.events);
});

// --- DATA PROCESSING ---
function processYTCaptions(rawEvents) {
    if (!rawEvents) return;
    
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
    }

    ytLyricsCache = valid.map(ev => ({
        startTimeMs: ev.tStartMs || 0,
        durationMs: ev.dDurationMs || 0,
        text: ev.segs.map(s => s.utf8 || '').join('').trim()
    }));

    applyPreferredSource();
}

function fetchLrcLibFallback() {
    let title = '', artist = '';
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title;
        artist = navigator.mediaSession.metadata.artist;
    }

    if (!title) return;
    
    title = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, '').split('-')[0].trim();
    const query = `${title} ${artist || ''}`.trim();

    chrome.runtime.sendMessage({ action: 'fetchLrcLib', query }, (results) => {
        if (results && results.length > 0 && results[0].syncedLyrics) {
            const lines = results[0].syncedLyrics.split('\n');
            const parsed = [];
            const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
            
            for (const line of lines) {
                const match = regex.exec(line);
                if (match) {
                    const ms = parseInt(match[1]) * 60000 + parseInt(match[2]) * 1000 + parseInt(match[3].padEnd(3, '0'));
                    parsed.push({ startTimeMs: ms, durationMs: 0, text: match[4].trim() });
                }
            }
            
            for (let i = 0; i < parsed.length - 1; i++) {
                parsed[i].durationMs = parsed[i+1].startTimeMs - parsed[i].startTimeMs;
            }
            if (parsed.length > 0) parsed[parsed.length - 1].durationMs = 5000;
            
            lrcLyricsCache = parsed;
            applyPreferredSource();
        }
    });
}

function applyPreferredSource() {
    let chosen = [];
    if (settings.primarySource === 'lrclib' && lrcLyricsCache.length > 0) {
        chosen = lrcLyricsCache;
    } else if (settings.primarySource === 'yt' && ytLyricsCache.length > 0) {
        chosen = ytLyricsCache;
    } else {
        chosen = lrcLyricsCache.length > 0 ? lrcLyricsCache : ytLyricsCache;
    }

    if (chosen.length === 0) {
        activeLyrics = [];
        return;
    }

    if (settings.romajiMode) {
        // Tampilkan lirik asli dulu sambil nunggu Romaji kelar diproses
        activeLyrics = chosen; 
        applyRomaji(chosen).then(res => { 
            activeLyrics = res; 
        });
    } else {
        activeLyrics = chosen;
    }
}

// --- ROMAJI PROCESSOR (Adapted from your side-chick) ---
async function applyRomaji(lyricsArray) {
    const jpRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    if (!lyricsArray.some(lyric => jpRegex.test(lyric.text))) return lyricsArray;

    const BATCH_SEPARATOR = "\n\n;\n\n";
    const MAX_URL_LENGTH = 14000;
    
    // Bikin copy biar gak ngotorin cache asli kalau diganti-ganti settingnya
    const results = JSON.parse(JSON.stringify(lyricsArray));
    const toProcess = [];

    // STEP 1: filter & prepare (sama persis kayak instruksi selingkuhanmu)
    results.forEach((item, index) => {
        const trimmed = item.text.trim();
        if (!trimmed || trimmed === "♪") return;
        toProcess.push({ index, text: trimmed });
    });

    if (toProcess.length === 0) return results;

    // STEP 2: chunking
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

    return new Promise((resolve) => {
        let done = 0;
        chunks.forEach(chunk => {
            const combinedText = chunk.map(i => i.text).join(BATCH_SEPARATOR);
            const url = baseUrl + encodeURIComponent(combinedText);

            chrome.runtime.sendMessage({ action: 'fetchRomaji', url }, (data) => {
                try {
                    let fullText = "";
                    if (data && data[0]) {
                        for (const part of data[0]) {
                            if (!part) continue;
                            const rm = part[3] || part[2] || "";
                            fullText += rm;
                        }

                        let linesOut = fullText.split(BATCH_SEPARATOR);

                        // Fallback kalau Google ngaco ngerusak separator
                        if (linesOut.length < chunk.length) {
                            const semi = fullText.split(";").filter(l => l.trim());
                            if (semi.length === chunk.length) {
                                linesOut = semi;
                            } else {
                                const nl = fullText.split(/\r?\n/).filter(l => l.trim());
                                if (nl.length === chunk.length) linesOut = nl;
                                else linesOut = []; 
                            }
                        }

                        // STEP 5: mapping balik ke index asli
                        chunk.forEach((item, i) => {
                            const translated = linesOut[i]?.trim();
                            if (translated) {
                                results[item.index].text = translated; // Timpa teks asli sama romaji
                            }
                        });
                    }
                } catch (e) {
                    console.error("[LyricsBridge] Romaji Parse Error", e);
                }

                done++;
                if (done === chunks.length) resolve(results);
            });
        });
    });
}

// --- SYNC LOOP ---
function syncLoop() {
    const video = document.querySelector('video');
    if (!video) { sendToApp('', ''); return; }

    const ms = video.currentTime * 1000;

    if (activeLyrics.length > 0) {
        const activeIdx = activeLyrics.findIndex(ev => ms >= ev.startTimeMs && ms < (ev.startTimeMs + ev.durationMs));
        
        if (activeIdx !== -1) {
            const currentLine = activeLyrics[activeIdx].text;
            const mainOut = settings.displayMode === 'all' ? currentLine : currentLine.split('\n')[0].trim();
            
            let upcOut = '';
            if (activeIdx + 1 < activeLyrics.length) {
                const nextLine = activeLyrics[activeIdx + 1].text;
                upcOut = settings.displayMode === 'all' ? nextLine : nextLine.split('\n')[0].trim();
            }
            sendToApp(mainOut, upcOut);
        } else {
            if (activeLyrics[0] && ms < activeLyrics[0].startTimeMs) {
                const firstLine = activeLyrics[0].text;
                sendToApp('', settings.displayMode === 'all' ? firstLine : firstLine.split('\n')[0].trim());
            } else {
                sendToApp('', '');
            }
        }
    } else {
        const domLyrics = document.querySelector('.ytmusic-player-lyrics-renderer [focused], .ytmusic-player-lyrics-renderer .active');
        if (domLyrics) {
            const nextDom = domLyrics.nextElementSibling;
            sendToApp(domLyrics.textContent.trim(), nextDom ? nextDom.textContent.trim() : '');
        } else {
            sendToApp('', '');
        }
    }
}

// --- TRACKER ---
setInterval(() => {
    const urlObj = new URL(window.location.href);
    const vid = urlObj.searchParams.get('v');
    if (vid && vid !== currentVideoId) {
        currentVideoId = vid;
        ytLyricsCache = [];
        lrcLyricsCache = [];
        activeLyrics = [];
        clearApp();
        setTimeout(fetchLrcLibFallback, 2500);
    }
}, 1000);

setInterval(syncLoop, POLL_MS);
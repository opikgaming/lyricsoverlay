// --- Configuration & State ---
const POLL_MS = 100;
let settings = { displayMode: 'all', primarySource: 'yt', romajiMode: false };

let ytLyricsCache = [];
let lrcLyricsCache = [];
let legatoCache = [];
let cubeyCache = [];
let activeLyrics = [];

let currentTrackName = ''; 
let lastMain = null;
let lastUpc = null;
let videoEl = null;

// ✨ NEW: Prevent raw lyrics from showing while Romaji is processing
let isProcessingRomaji = false; 

chrome.storage.local.get(settings, (res) => { settings = res; });

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "settingsUpdated") {
        settings = request.settings;
        clearApp();
        applyPreferredSource();
    } else if (request.action === "cubeyTokenReady") {
        console.log("[Bridge-Content] 🟢 Cubey token is ready. Re-fetching...");
        if (currentTrackName) fetchCubeyOnly();
    }
});

function sendToApp(main, upcoming) {
    if (main === lastMain && upcoming === lastUpc) return;
    lastMain = main; lastUpc = upcoming;
    chrome.runtime.sendMessage({ action: 'sendSubtitle', payload: { main, upcoming } });
}

function clearApp() {
    lastMain = null; lastUpc = null;
    chrome.runtime.sendMessage({ action: 'clearSubtitle' });
}

window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'LYRICS_BRIDGE_YT') return;
    processYTCaptions(event.data.events);
});

// --- LRC Parser ---
function parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    const lines = lrcText.split('\n');
    const parsed = [];
    const timeTagRegex = /\[(\d{2,}):(\d{2})\.(\d{1,3})\]/g;
    const wordTagRegex = /<\d{2}:\d{2}\.\d{2,3}>/g;

    for (const line of lines) {
        let m;
        const times = [];
        timeTagRegex.lastIndex = 0; 
        
        while ((m = timeTagRegex.exec(line)) !== null) {
            times.push(parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, '0')));
        }
        if (times.length > 0) {
            let text = line.replace(timeTagRegex, '').replace(wordTagRegex, '').trim();
            if (text) times.forEach(t => parsed.push({ startTimeMs: t, durationMs: 0, text }));
        }
    }

    parsed.sort((a,b) => a.startTimeMs - b.startTimeMs);
    for (let i = 0; i < parsed.length - 1; i++) parsed[i].durationMs = parsed[i+1].startTimeMs - parsed[i].startTimeMs;
    if (parsed.length > 0) parsed[parsed.length - 1].durationMs = 5000;
    return parsed;
}

// --- TTML Parser (Apple Music TTML Parser) ---
function parseTTML(ttmlText) {
    if (!ttmlText || typeof ttmlText !== 'string') return [];
    const parsed = [];
    
    // Regex to extract <p> tags and their begin times
    const pRegex = /<p[^>]*begin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    
    while ((match = pRegex.exec(ttmlText)) !== null) {
        const beginStr = match[1];
        // Strip inner tags (like <span xmlns...>) to get raw lyrics
        const text = match[2].replace(/<[^>]+>/g, '').trim(); 
        
        if (beginStr && text) {
            const timeParts = beginStr.split(':');
            let ms = 0;
            
            // Handle HH:MM:SS.sss, MM:SS.sss, AND SS.sss formats!
            if (timeParts.length === 3) {
                ms += parseInt(timeParts[0]) * 3600000; // Hours
                ms += parseInt(timeParts[1]) * 60000;   // Minutes
                ms += parseFloat(timeParts[2]) * 1000;  // Seconds
            } else if (timeParts.length === 2) {
                ms += parseInt(timeParts[0]) * 60000;
                ms += parseFloat(timeParts[1]) * 1000;
            } else if (timeParts.length === 1) {
                ms += parseFloat(timeParts[0]) * 1000;  // Just seconds (Apple Music does this < 1 min)
            }
            
            if (!isNaN(ms)) {
                parsed.push({ startTimeMs: Math.round(ms), durationMs: 0, text });
            }
        }
    }
    
    parsed.sort((a, b) => a.startTimeMs - b.startTimeMs);
    for (let i = 0; i < parsed.length - 1; i++) {
        parsed[i].durationMs = parsed[i+1].startTimeMs - parsed[i].startTimeMs;
    }
    if (parsed.length > 0) parsed[parsed.length - 1].durationMs = 5000;
    
    return parsed;
}

// --- Data Processing ---
function processYTCaptions(rawEvents) {
    if (!rawEvents) return;
    let valid = rawEvents.filter(ev => ev.segs && ev.segs.some(s => s.utf8 && s.utf8.trim().length > 0));
    valid.sort((a, b) => (a.tStartMs || 0) - (b.tStartMs || 0));

    for (let i = 1; i < valid.length; i++) {
        let prev = valid[i-1], curr = valid[i];
        if (Math.abs((curr.tStartMs || 0) - (prev.tStartMs || 0)) <= 150) {
            let minS = Math.min(prev.tStartMs || 0, curr.tStartMs || 0);
            prev.tStartMs = minS; curr.tStartMs = minS;
        }
    }

    ytLyricsCache = valid.map(ev => ({
        startTimeMs: ev.tStartMs || 0,
        durationMs: ev.dDurationMs || 0,
        text: ev.segs.map(s => s.utf8 || '').join('').trim()
    }));
    applyPreferredSource();
}

function fetchExternalSources() {
    let title = '', artist = '', album = '';
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title;
        artist = navigator.mediaSession.metadata.artist;
        album = navigator.mediaSession.metadata.album || '';
    }
    if (!title) return;
    
    title = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, '').split('-')[0].trim();
    const qStr = `${title} ${artist || ''}`.trim();

    let duration = '';
    const vid = document.querySelector('video');
    if (vid && vid.duration && !isNaN(vid.duration)) {
        duration = Math.round(vid.duration).toString();
    }

    console.log(`[Bridge-Content] 🎵 Target: "${title}" | Duration: ${duration}s | Album: ${album}`);

    chrome.runtime.sendMessage({ action: 'fetchLrcLib', query: qStr }, (res) => {
        if (res && res.length > 0 && res[0].syncedLyrics) {
            // ✨ NEW: Added missing LRCLib debug comments in formal English ✨
            console.log("[Bridge-Content] ✅ Successfully retrieved synced lyrics from LRCLib.");
            lrcLyricsCache = parseLRC(res[0].syncedLyrics);
            applyPreferredSource();
        } else {
            console.log("[Bridge-Content] ⚠️ No synced lyrics found on LRCLib.");
        }
    });

    chrome.runtime.sendMessage({ action: 'fetchLegato', query: { s: title, a: artist, d: duration, al: album } }, (res) => {
        if (res) {
            if (res.ttml) {
                console.log("[Bridge-Content] ✅ Successfully retrieved TTML from Legato V2.");
                legatoCache = parseTTML(res.ttml);
                applyPreferredSource();
            } else {
                let lyrics = res.lyrics || res.data?.lyrics || res.lrc;
                if (lyrics) {
                    console.log("[Bridge-Content] ✅ Successfully retrieved LRC from Legato V2.");
                    legatoCache = parseLRC(lyrics);
                    applyPreferredSource();
                } else {
                    console.log("[Bridge-Content] ⚠️ Data from Legato is empty or was blocked:", res);
                }
            }
        }
    });

    fetchCubeyOnly();
}

function fetchCubeyOnly() {
    let title = '', artist = '';
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title;
        artist = navigator.mediaSession.metadata.artist;
    }
    if (!title) return;
    title = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, '').split('-')[0].trim();
    
    chrome.runtime.sendMessage({ action: 'fetchCubey', query: { s: title, a: artist } }, (res) => {
        if (res) {
            let data = Array.isArray(res) ? res[0] : res;
            if (data) {
                let bestLrc = data.musixmatchSyncedLyrics || data.musixmatchWordByWordLyrics || data.lrclibSyncedLyrics || data.syncedLyrics || data.lyrics;
                if (bestLrc) {
                    cubeyCache = parseLRC(bestLrc);
                    applyPreferredSource();
                }
            }
        }
    });
}

function applyPreferredSource() {
    let chosen = [];
    let activeProvider = 'none';
    
    const sources = {
        'cubey': cubeyCache,
        'legato': legatoCache,
        'lrclib': lrcLyricsCache,
        'yt': ytLyricsCache
    };

    if (sources[settings.primarySource] && sources[settings.primarySource].length > 0) {
        chosen = sources[settings.primarySource];
        activeProvider = settings.primarySource;
    } else {
        if (cubeyCache.length > 0) { chosen = cubeyCache; activeProvider = 'cubey'; }
        else if (legatoCache.length > 0) { chosen = legatoCache; activeProvider = 'legato'; }
        else if (lrcLyricsCache.length > 0) { chosen = lrcLyricsCache; activeProvider = 'lrclib'; }
        else if (ytLyricsCache.length > 0) { chosen = ytLyricsCache; activeProvider = 'yt'; }
    }

    chrome.runtime.sendMessage({ action: 'updateBadge', source: activeProvider });

    if (chosen.length === 0) { 
        activeLyrics = []; 
        isProcessingRomaji = false;
        return; 
    }

    if (settings.romajiMode) {
        // ✨ FIX: Do not instantly assign chosen array to activeLyrics to prevent raw JP text flash
        isProcessingRomaji = true;
        
        // Clone the array so we don't accidentally mutate the original cache with Romaji text
        const clonedChosen = JSON.parse(JSON.stringify(chosen));
        
        applyRomaji(clonedChosen).then(res => { 
            activeLyrics = res; 
            isProcessingRomaji = false; // Release the lock
        });
    } else {
        activeLyrics = chosen;
        isProcessingRomaji = false;
    }
}

// --- Romaji Processor ---
async function applyRomaji(lyricsArray) {
    const fullText = lyricsArray.map(l => l.text).join(' ');
    let sl = '';
    
    // Automatic language detection
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(fullText)) sl = 'ja'; 
    else if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(fullText)) sl = 'ko'; 
    else if (/[\u4E00-\u9FAF]/.test(fullText)) sl = 'zh-CN'; 
    else if (/[\u0400-\u04FF]/.test(fullText)) sl = 'ru'; 
    else if (/[\u0E00-\u0E7F]/.test(fullText)) sl = 'th'; 
    else if (/[\u0600-\u06FF]/.test(fullText)) sl = 'ar'; 
    else if (/[\u0900-\u097F]/.test(fullText)) sl = 'hi'; 

    if (!sl) return lyricsArray; 

    const BATCH_SEP = "\n\n;\n\n";
    const MAX_URL = 14000;
    const results = JSON.parse(JSON.stringify(lyricsArray));
    const toProcess = [];
    
    results.forEach((item, index) => {
        const t = item.text.trim();
        if (t && t !== "♪") toProcess.push({ index, text: t });
    });
    if (toProcess.length === 0) return results;

    const preprocess = (txt) => sl === 'ja' ? txt.replace(/君/g, 'kimi ') : txt;

    const chunks = [];
    let curChunk = [], curLen = 0;
    const baseUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=en&dt=t&dt=rm&q=`;
    
    for (const item of toProcess) {
        const safeText = preprocess(item.text);
        const addLen = (curChunk.length > 0 ? encodeURIComponent(BATCH_SEP).length : 0) + encodeURIComponent(safeText).length;
        if (curChunk.length > 0 && baseUrl.length + curLen + addLen > MAX_URL) {
            chunks.push(curChunk); curChunk = []; curLen = 0;
        }
        curChunk.push({ ...item, preprocessedText: safeText }); curLen += addLen;
    }
    if (curChunk.length > 0) chunks.push(curChunk);

    return new Promise((resolve) => {
        let done = 0;
        chunks.forEach(chunk => {
            const url = baseUrl + encodeURIComponent(chunk.map(i => i.preprocessedText).join(BATCH_SEP));
            chrome.runtime.sendMessage({ action: 'fetchRomaji', url }, (data) => {
                try {
                    if (data && data[0]) {
                        let resultText = "";
                        for (const part of data[0]) { 
                            if(part) resultText += (part[3] || part[2] || ""); 
                        }
                        
                        let linesOut = resultText.split(BATCH_SEP);
                        if (linesOut.length < chunk.length) {
                            const semi = resultText.split(";").filter(l => l.trim());
                            linesOut = semi.length === chunk.length ? semi : resultText.split(/\r?\n/).filter(l => l.trim());
                        }

                        chunk.forEach((item, i) => {
                            if (linesOut[i]) results[item.index].text = linesOut[i].trim();
                        });
                    }
                } catch (e) {}
                done++;
                if (done === chunks.length) resolve(results);
            });
        });
    });
}

// --- Synchronization Loop ---
function syncLoop(forcedTimeMs = null) {
    // ✨ FIX: Suppress updating the UI if Romaji translation is currently in progress
    if (!videoEl || isProcessingRomaji) return; 
    
    const ms = forcedTimeMs !== null ? forcedTimeMs : videoEl.currentTime * 1000;

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
            } else { sendToApp('', ''); }
        }
    } else {
        const domLyrics = document.querySelector('.ytmusic-player-lyrics-renderer [focused], .ytmusic-player-lyrics-renderer .active');
        if (domLyrics) {
            const nextDom = domLyrics.nextElementSibling;
            sendToApp(domLyrics.textContent.trim(), nextDom ? nextDom.textContent.trim() : '');
        } else { sendToApp('', ''); }
    }
}

function checkSongChange() {
    if (!navigator.mediaSession || !navigator.mediaSession.metadata) return;
    const newTrack = navigator.mediaSession.metadata.title;
    
    if (newTrack && newTrack !== currentTrackName) {
        currentTrackName = newTrack;
        ytLyricsCache = []; lrcLyricsCache = []; legatoCache = []; cubeyCache = []; activeLyrics = [];
        clearApp();
        setTimeout(fetchExternalSources, 2000); 
    }
}

function initVideoHook() {
    videoEl = document.querySelector('video');
    if (videoEl) {
        videoEl.addEventListener('timeupdate', () => {
            syncLoop(videoEl.currentTime * 1000);
        });
    } else {
        setTimeout(initVideoHook, 1000); 
    }
}

initVideoHook();

setInterval(() => {
    checkSongChange();
    if (document.hasFocus()) syncLoop(); 
}, POLL_MS);
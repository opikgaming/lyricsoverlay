let cubeyJwt = null;
let creatingOffscreen = null;

async function setupOffscreen() {
    console.log("[Bridge-BG] 🕵️ Membuka Offscreen buat mecahin Turnstile Cubey...");
    const extUrl = chrome.runtime.getURL('offscreen.html');
    const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existingContexts.find(c => c.documentUrl === extUrl)) return;
    
    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: 'offscreen.html', reasons: ['IFRAME_SCRIPTING'], justification: 'Solve Cubey Turnstile'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sendSubtitle') {
        fetch('http://localhost:7331/subtitle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.payload)
        }).catch(() => {});
        sendResponse({ success: true });
        
    } else if (request.action === 'clearSubtitle') {
        fetch('http://localhost:7331/clear', { method: 'POST' }).catch(() => {});
        chrome.action.setBadgeText({text: ''}); 
        sendResponse({ success: true });
        
    } else if (request.action === 'updateBadge') {
        let text = '', color = '#52525b';
        switch(request.source) {
            case 'cubey': text = 'MM'; color = '#eab308'; break; 
            case 'legato': text = 'KG'; color = '#3b82f6'; break; 
            case 'lrclib': text = 'LRC'; color = '#10b981'; break; 
            case 'yt': text = 'YT'; color = '#ef4444'; break; 
        }
        chrome.action.setBadgeText({text: text, tabId: sender.tab?.id});
        chrome.action.setBadgeBackgroundColor({color: color, tabId: sender.tab?.id});
        sendResponse({ success: true });

    } else if (request.action === 'fetchRomaji') {
        fetch(request.url).then(res => res.json()).then(data => sendResponse(data)).catch(() => sendResponse(null)); return true; 
    
    } else if (request.action === 'fetchLrcLib') {
        fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(request.query)}`)
            .then(res => res.json()).then(data => sendResponse(data)).catch(() => sendResponse(null)); return true; 
    
    // ✨ INI YANG BARU BUAT LEGATO ✨
    } else if (request.action === 'fetchLegato') {
        const url = new URL("https://lyrics-api.boidu.dev/getLyrics");
        url.searchParams.append("s", request.query.s);
        if (request.query.a) url.searchParams.append("a", request.query.a);
        if (request.query.d) url.searchParams.append("d", request.query.d);
        if (request.query.al) url.searchParams.append("al", request.query.al);

        console.log(`[Bridge-BG] 🔍 Legato V2 Fetch: ${url.toString()}`);
        
        fetch(url.toString())
            .then(res => res.json()).then(data => {
                console.log("[Bridge-BG] 📦 Hasil Legato:", data);
                sendResponse(data);
            }).catch(err => {
                console.error("[Bridge-BG] ❌ Legato Error:", err);
                sendResponse(null);
            }); 
        return true;
    
    } else if (request.action === 'turnstileToken') {
        fetch('https://lyrics.api.dacubeking.com/verify-turnstile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: request.token })
        }).then(res => res.json()).then(data => {
            if (data && data.jwt) {
                cubeyJwt = data.jwt;
                chrome.tabs.query({url: "*://*.youtube.com/*"}, (tabs) => {
                    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, {action: 'cubeyTokenReady'}));
                });
                chrome.offscreen.closeDocument().catch(()=>{});
            }
        }).catch(()=>{});
        sendResponse({success: true});
        
    } else if (request.action === 'fetchCubey') {
        if (!cubeyJwt) { setupOffscreen(); sendResponse(null); return true; }
        const url = `https://lyrics.api.dacubeking.com/lyrics?song=${encodeURIComponent(request.query.s)}&artist=${encodeURIComponent(request.query.a)}`;
        fetch(url, { headers: { 'Authorization': `Bearer ${cubeyJwt}` } })
            .then(async res => { 
                if (!res.ok) {
                    if (res.status === 403 || res.status === 401) { cubeyJwt = null; setupOffscreen(); }
                    throw new Error(`HTTP ${res.status}`); 
                } 
                return res.json(); 
            })
            .then(data => sendResponse(data))
            .catch((err) => sendResponse(null));
        return true;
    }
});
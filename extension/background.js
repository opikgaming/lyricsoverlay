// Handles CORS-restricted network requests and passes data to localhost
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === 'sendSubtitle') {
        fetch('http://localhost:7331/subtitle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        }).catch(() => { /* Ignore localhost connection errors silently */ });
        sendResponse({ success: true });
        
    } else if (request.action === 'clearSubtitle') {
        fetch('http://localhost:7331/clear', { method: 'POST' }).catch(() => {});
        sendResponse({ success: true });
        
    } else if (request.action === 'fetchRomaji') {
        fetch(request.url)
            .then(res => res.json())
            .then(data => sendResponse(data))
            .catch(err => {
                console.error("[LyricsBridge] Romaji Error:", err);
                sendResponse(null);
            });
        return true; // Keep message channel open for async response
        
    } else if (request.action === 'fetchLrcLib') {
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(request.query)}`;
        fetch(url)
            .then(res => res.json())
            .then(data => sendResponse(data))
            .catch(err => {
                console.error("[LyricsBridge] LRCLIB Error:", err);
                sendResponse(null);
            });
        return true; 
    }
});
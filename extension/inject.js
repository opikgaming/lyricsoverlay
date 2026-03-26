(function() {
    let currentTrackUrl = null;

    function sendToContent(events, source) {
        window.postMessage({ type: 'LYRICS_BRIDGE_YT', events: events, source: source }, '*');
    }

    // 1:1 Logic lama kamu: Ambil lirik dari Player Response kalau XHR ga kedetect
    function checkPlayerResponse() {
        try {
            let pr = window.ytInitialPlayerResponse;
            const player = document.querySelector('#movie_player');
            if (player && typeof player.getPlayerResponse === 'function') {
                const pr_fresh = player.getPlayerResponse();
                if (pr_fresh) pr = pr_fresh;
            }
            if (!pr) return;
            const ctl = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!ctl || ctl.length === 0) return;

            // 1:1 Logic lama kamu: Prioritas Bahasa biar ga nyomot Auto-Generate aneh
            const LANG_PRIORITY = ['ie', 'id', 'en', 'ja', 'en-us', 'en-gb'];
            let track = ctl[0];
            let found = false;

            for (let lang of LANG_PRIORITY) {
                let match = ctl.find(t => t.languageCode === lang);
                if (match) { track = match; found = true; break; }
            }
            if (!found) {
                let asr = ctl.find(t => t.vssId && t.vssId.includes('a.')); // Auto-generated fallback
                if (asr) track = asr;
            }

            if (track && track.baseUrl && track.baseUrl !== currentTrackUrl) {
                currentTrackUrl = track.baseUrl;
                let fetchUrl = track.baseUrl.replace(/&fmt=[^&]*/g, '').replace(/\?fmt=[^&]*/g, '') + '&fmt=json3';
                fetch(fetchUrl).then(r => r.json()).then(data => {
                    if (data && data.events) sendToContent(data.events, 'player_response');
                }).catch(()=>{});
            }
        } catch(e) {}
    }

    // --- XHR Intercept ---
    const origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        this._url = typeof url === 'string' ? url : '';
        this.addEventListener('load', function() {
            if (this._url && this._url.includes('timedtext') && this._url.includes('fmt=json3')) {
                currentTrackUrl = this._url;
                try {
                    const data = JSON.parse(this.responseText);
                    sendToContent(data.events, 'xhr');
                } catch(e) {}
            }
        });
        return origOpen.apply(this, arguments);
    };

    // --- Fetch Intercept ---
    const origFetch = window.fetch;
    window.fetch = async function() {
        const url = arguments[0] ? arguments[0].toString() : '';
        const response = await origFetch.apply(this, arguments);
        if (url.includes('timedtext') && url.includes('fmt=json3')) {
            currentTrackUrl = url;
            response.clone().json().then(data => {
                if (data && data.events) sendToContent(data.events, 'fetch');
            }).catch(() => {});
        }
        return response;
    };

    // Trigger pas ganti lagu di YouTube/YTM (SPA Routing)
    window.addEventListener('yt-navigate-finish', () => {
        currentTrackUrl = null;
        setTimeout(checkPlayerResponse, 1500);
    });

    // Trigger pas load pertama
    setTimeout(checkPlayerResponse, 2500);
})();
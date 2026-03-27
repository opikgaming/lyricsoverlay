// Dengerin sinyal dari iframe Turnstile yang ada di ruangan ini
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'turnstile-token') {
        // Kirim token-nya ke background worker!
        chrome.runtime.sendMessage({ 
            action: 'turnstileToken', 
            token: event.data.token 
        });
    }
});
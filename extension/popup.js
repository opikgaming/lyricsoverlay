document.addEventListener('DOMContentLoaded', () => {
    const displayMode = document.getElementById('displayMode');
    const primarySource = document.getElementById('primarySource');
    const romajiToggle = document.getElementById('romajiToggle');

    // Load saved settings
    chrome.storage.local.get({
        displayMode: 'all',
        primarySource: 'yt',
        romajiMode: false
    }, (settings) => {
        displayMode.value = settings.displayMode;
        primarySource.value = settings.primarySource;
        romajiToggle.checked = settings.romajiMode;
    });

    // Save and notify content script on change
    function updateSettings() {
        const newSettings = {
            displayMode: displayMode.value,
            primarySource: primarySource.value,
            romajiMode: romajiToggle.checked
        };
        
        chrome.storage.local.set(newSettings, () => {
            // Notify active tabs
            chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
                for (const tab of tabs) {
                    chrome.tabs.sendMessage(tab.id, { action: "settingsUpdated", settings: newSettings });
                }
            });
        });
    }

    displayMode.addEventListener('change', updateSettings);
    primarySource.addEventListener('change', updateSettings);
    romajiToggle.addEventListener('change', updateSettings);
});
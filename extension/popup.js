document.addEventListener('DOMContentLoaded', () => {
    // Tangkap semua elemen dari popup.html
    const toggleBtn = document.getElementById('toggleBtn');
    const sourceSelect = document.getElementById('sourceSelect');
    const romajiBtn = document.getElementById('romajiBtn');
    const displayBtn = document.getElementById('displayBtn');

    // Load settingan yang kesimpen (Defaultnya: ON, Legato, Romaji OFF, Semua Baris)
    chrome.storage.local.get({
        isActive: true,
        primarySource: 'legato',
        romajiMode: false,
        displayMode: 'all'
    }, (settings) => {
        updateUI(settings);
    });

    // ── EVENT LISTENERS (Pas tombol dipencet) ──

    toggleBtn.addEventListener('click', () => {
        chrome.storage.local.get(['isActive'], (res) => {
            const newState = res.isActive === false ? true : false;
            saveAndNotify({ isActive: newState });
        });
    });

    sourceSelect.addEventListener('change', (e) => {
        saveAndNotify({ primarySource: e.target.value });
    });

    romajiBtn.addEventListener('click', () => {
        chrome.storage.local.get(['romajiMode'], (res) => {
            const newState = !res.romajiMode;
            saveAndNotify({ romajiMode: newState });
        });
    });

    displayBtn.addEventListener('click', () => {
        chrome.storage.local.get(['displayMode'], (res) => {
            const newState = res.displayMode === 'all' ? 'top' : 'all';
            saveAndNotify({ displayMode: newState });
        });
    });

    // ── FUNGSI INTI ──

    // Simpan ke storage & teriak ke Content Script biar langsung update!
    function saveAndNotify(newSetting) {
        chrome.storage.local.get({
            isActive: true, primarySource: 'yt', romajiMode: false, displayMode: 'all'
        }, (currentSettings) => {
            const updatedSettings = { ...currentSettings, ...newSetting };
            
            chrome.storage.local.set(updatedSettings, () => {
                updateUI(updatedSettings); // Update warna tombol di pop-up

                // Beritahu content.js yang lagi jalan di tab YouTube
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: "settingsUpdated", 
                            settings: updatedSettings
                        }).catch(() => {}); // Cuekin error kalau tabnya bukan YouTube
                    }
                });

                // Beritahu background.js juga (jaga-jaga)
                chrome.runtime.sendMessage({
                    action: "settingsUpdated", 
                    settings: updatedSettings
                }).catch(() => {});
            });
        });
    }

    // Ganti teks dan warna tombol sesuai status
    function updateUI(settings) {
        // Toggle Master
        toggleBtn.textContent = settings.isActive ? "ON" : "OFF";
        if (settings.isActive) {
            toggleBtn.classList.remove('off');
        } else {
            toggleBtn.classList.add('off');
        }

        // Dropdown Source
        sourceSelect.value = settings.primarySource;

        // Toggle Romaji
        romajiBtn.textContent = settings.romajiMode ? "ON" : "OFF";
        if (settings.romajiMode) {
            romajiBtn.classList.remove('off');
        } else {
            romajiBtn.classList.add('off');
        }

        // Toggle Display Mode
        displayBtn.textContent = settings.displayMode === 'all' ? "ALL" : "ONE LINE";
        if (settings.displayMode !== 'all') {
            displayBtn.classList.add('off');
        } else {
            displayBtn.classList.remove('off');
        }
    }
});
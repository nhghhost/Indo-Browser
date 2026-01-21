const urlInput = document.getElementById('url-input');
const goBtn = document.getElementById('go-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const homeBtn = document.getElementById('home-btn');
const devtoolsBtn = document.getElementById('devtools-btn');
const loadingIndicator = document.getElementById('loading');
const historyBtn = document.getElementById('history-btn');

const tabsBar = document.getElementById('tabs-bar');
const newTabBtn = document.getElementById('new-tab-btn');

const historyOverlay = document.getElementById('history-overlay');
const historyList = document.getElementById('history-list');
const historyCloseBtn = document.getElementById('history-close-btn');

console.log('Renderer loaded');
console.log('window.electronAPI =', window.electronAPI);

// ====== STATE TAB ======
let tabs = [];
let activeTabId = null;
let tabIdCounter = 1;
let historyEntries = [];

function createTab(url = 'https://www.google.com') {
    const id = tabIdCounter++;

    // Tab button
    const tabEl = document.createElement('button');
    tabEl.classList.add('tab');
    tabEl.dataset.id = String(id);

    const titleSpan = document.createElement('span');
    titleSpan.classList.add('tab-title');
    titleSpan.textContent = 'New Tab';

    const closeBtn = document.createElement('button');
    closeBtn.classList.add('tab-close');
    closeBtn.textContent = '×';

    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabsBar.insertBefore(tabEl, newTabBtn);

    const tab = {
        id,
        title: ' ',
        url,
        el: tabEl,
        titleEl: titleSpan,
    };
    tabs.push(tab);

    tabEl.addEventListener('click', (e) => {
        if (e.target === closeBtn) return;
        setActiveTab(id);
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });

    // ✅ Kirim ke main process buat bikin BrowserView
    window.electronAPI.createView(id, url);

    setActiveTab(id);
    return tab;
}

function setActiveTab(id) {
    activeTabId = id;

    // Tab button active
    const tabButtons = tabsBar.querySelectorAll('.tab');
    tabButtons.forEach(btn => {
        if (btn.dataset.id === String(id)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    urlInput.value = tab.url || '';

    // ✅ Kirim ke main process buat switch view
    window.electronAPI.setActiveView(id);
}

function closeTab(id) {
    if (tabs.length === 1) {
        loadURLInActiveTab('https://www.google.com');
        return;
    }

    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];

    tabs.splice(idx, 1);

    const tabButton = tabsBar.querySelector(`.tab[data-id="${id}"]`);
    if (tabButton) tabButton.remove();

    // ✅ Kirim ke main process buat destroy view
    window.electronAPI.destroyView(id);

    if (activeTabId === id) {
        const newActive = tabs[idx] || tabs[idx - 1] || tabs[0];
        if (newActive) setActiveTab(newActive.id);
    }
}

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
}

// ====== URL Handling ======
function formatURL(url) {
    if (!url) return '';

    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    if (url.startsWith('localhost')) {
        return 'http://' + url;
    }

    if (!url.includes('.')) {
        return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }

    return 'https://' + url;
}

function loadURLInActiveTab(rawUrl) {
    const formatted = formatURL(rawUrl);
    const tab = getActiveTab();
    if (!tab) return;

    tab.url = formatted;
    urlInput.value = formatted;

    // ✅ Kirim ke main process buat load URL
    window.electronAPI.loadURL(tab.id, formatted);
}

// ====== UI EVENTS ======
goBtn.addEventListener('click', () => {
    loadURLInActiveTab(urlInput.value);
});

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loadURLInActiveTab(urlInput.value);
    }
});

backBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) window.electronAPI.goBack(tab.id);
});

forwardBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) window.electronAPI.goForward(tab.id);
});

reloadBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) window.electronAPI.reload(tab.id);
});

homeBtn.addEventListener('click', () => {
    loadURLInActiveTab('https://www.google.com');
});

newTabBtn.addEventListener('click', () => {
    createTab('https://www.google.com');
});

devtoolsBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) window.electronAPI.toggleDevTools(tab.id);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        const tab = getActiveTab();
        if (tab) window.electronAPI.toggleDevTools(tab.id);
    }
});

// ====== HISTORY ======
historyBtn.addEventListener('click', () => {
    historyList.innerHTML = '';

    if (historyEntries.length === 0) {
        const empty = document.createElement('div');
        empty.classList.add('history-item');
        empty.textContent = 'No history yet.';
        historyList.appendChild(empty);
    } else {
        const entries = [...historyEntries].slice().reverse();

        entries.forEach((h) => {
            const item = document.createElement('div');
            item.classList.add('history-item');

            const titleEl = document.createElement('div');
            titleEl.classList.add('history-item-title');
            titleEl.textContent = h.title || h.url;

            const urlEl = document.createElement('div');
            urlEl.classList.add('history-item-url');
            urlEl.textContent = h.url;

            const timeEl = document.createElement('div');
            timeEl.classList.add('history-item-time');
            const date = new Date(h.timestamp);
            timeEl.textContent = date.toLocaleString();

            item.appendChild(titleEl);
            item.appendChild(urlEl);
            item.appendChild(timeEl);

            item.addEventListener('click', () => {
                loadURLInActiveTab(h.url);
                historyOverlay.classList.remove('show');
                // ✅ Show BrowserView lagi
                window.electronAPI.showView();
            });

            historyList.appendChild(item);
        });
    }

    historyOverlay.classList.add('show');
    // ✅ Hide BrowserView biar overlay keliatan
    window.electronAPI.hideView();
});

historyCloseBtn.addEventListener('click', () => {
    historyOverlay.classList.remove('show');
    // ✅ Show BrowserView lagi
    window.electronAPI.showView();
});

historyOverlay.addEventListener('click', (e) => {
    if (e.target === historyOverlay) {
        historyOverlay.classList.remove('show');
        // ✅ Show BrowserView lagi
        window.electronAPI.showView();
    }
});

// ====== IPC LISTENERS (dari main process) ======
if (window.electronAPI) {
    // Update navigation buttons
    window.electronAPI.onNavigationState((data) => {
        const tab = tabs.find(t => t.id === data.tabId);
        if (tab && tab.id === activeTabId) {
            backBtn.disabled = !data.canGoBack;
            forwardBtn.disabled = !data.canGoForward;
        }
    });

    // Update URL bar - JANGAN save history di sini
    window.electronAPI.onURLChange((data) => {
        const tab = tabs.find(t => t.id === data.tabId);
        if (tab) {
            tab.url = data.url;
            if (tab.id === activeTabId) {
                urlInput.value = data.url;
            }
            // ❌ BUANG ini dari sini
        }
    });

    // ✅ Update title DAN save history di sini
    window.electronAPI.onTitleChange((data) => {
        const tab = tabs.find(t => t.id === data.tabId);
        if (tab) {
            tab.title = data.title;
            tab.titleEl.textContent = data.title.slice(0, 20);

            // ✅ Save history setelah title ready
            const entry = {
                url: tab.url,
                title: data.title,
                timestamp: new Date().toISOString(),
            };
            const last = historyEntries[historyEntries.length - 1];
            if (!last || last.url !== entry.url) {
                historyEntries.push(entry);
                console.log('History saved:', entry);
            }
        }
    });

    // Loading state
    window.electronAPI.onLoadingStart((data) => {
        const tab = tabs.find(t => t.id === data.tabId);
        if (tab && tab.id === activeTabId) {
            loadingIndicator.classList.add('show');
        }
    });

    window.electronAPI.onLoadingStop((data) => {
        const tab = tabs.find(t => t.id === data.tabId);
        if (tab && tab.id === activeTabId) {
            loadingIndicator.classList.remove('show');
        }
    });

    // Context menu actions
    window.electronAPI.onCtxOpenInNewTab((url) => {
        if (url) createTab(url);
    });

    window.electronAPI.onCtxOpenInNewWindow((url) => {
        if (url) window.open(url);
    });

    window.electronAPI.onCtxTranslate((text) => {
        if (!text) return;
        const url = `https://translate.google.com/?sl=auto&tl=id&op=translate&text=${encodeURIComponent(text)}`;
        createTab(url);
    });

    window.electronAPI.onOpenUrlInNewTab((url) => {
        if (url) createTab(url);
    });
}

// ====== INIT ======
createTab('https://www.google.com');

console.log('Browser with BrowserView ready!');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Send to main
    createView: (tabId, url) => ipcRenderer.send('create-view', tabId, url),
    setActiveView: (tabId) => ipcRenderer.send('set-active-view', tabId),
    destroyView: (tabId) => ipcRenderer.send('destroy-view', tabId),
    loadURL: (tabId, url) => ipcRenderer.send('load-url', tabId, url),
    goBack: (tabId) => ipcRenderer.send('go-back', tabId),
    goForward: (tabId) => ipcRenderer.send('go-forward', tabId),
    reload: (tabId) => ipcRenderer.send('reload', tabId),
    toggleDevTools: (tabId) => ipcRenderer.send('toggle-devtools', tabId),

    // ✅ TAMBAH INI
    hideView: () => ipcRenderer.send('hide-view'),
    showView: () => ipcRenderer.send('show-view'),

    // Receive from main
    onNavigationState: (callback) => ipcRenderer.on('navigation-state', (_e, data) => callback(data)),
    onURLChange: (callback) => ipcRenderer.on('url-change', (_e, data) => callback(data)),
    onTitleChange: (callback) => ipcRenderer.on('title-change', (_e, data) => callback(data)),
    onLoadingStart: (callback) => ipcRenderer.on('loading-start', (_e, data) => callback(data)),
    onLoadingStop: (callback) => ipcRenderer.on('loading-stop', (_e, data) => callback(data)),

    // Context menu
    onCtxOpenInNewTab: (callback) => ipcRenderer.on('ctx-open-in-new-tab', (_e, url) => callback(url)),
    onCtxOpenInNewWindow: (callback) => ipcRenderer.on('ctx-open-in-new-window', (_e, url) => callback(url)),
    onCtxTranslate: (callback) => ipcRenderer.on('ctx-translate-selection', (_e, text) => callback(text)),
    onOpenUrlInNewTab: (callback) => ipcRenderer.on('open-url-in-new-tab', (_e, url) => callback(url))
});

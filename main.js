const { app, BrowserWindow, BrowserView, Menu, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
const views = new Map();
let activeViewId = null;

// ✅ Widevine switches SEBELUM app.whenReady()
app.commandLine.appendSwitch('enable-widevine-cdm');
app.commandLine.appendSwitch('widevine-cdm-path', process.execPath);

// ✅ Media/Audio permissions
app.commandLine.appendSwitch('--enable-features',
    'DnsOverHttps,NetworkService,NetworkServiceInProcess,EncryptedClientHello,MediaEngagementBypassAutoplayPolicies'
);
app.commandLine.appendSwitch('--autoplay-policy', 'no-user-gesture-required');

// DNS & SSL switches
app.commandLine.appendSwitch('--dns-over-https-server', 'https://1.1.1.1/dns-query');
app.commandLine.appendSwitch('--disable-dns-prefetch');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('--ssl-version-min', 'tls1.2');
app.commandLine.appendSwitch('--disable-web-security');

const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: "icon.ico",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            plugins: true, // ✅ Enable plugins for Widevine
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('resize', () => {
        updateViewBounds();
    });

    mainWindow.on('closed', () => {
        views.clear();
    });
}

function updateViewBounds() {
    if (!mainWindow) return;

    const bounds = mainWindow.getContentBounds();
    const view = views.get(activeViewId);

    if (view) {
        const topOffset = 110;
        const sideMargin = 10;

        view.setBounds({
            x: sideMargin,
            y: topOffset,
            width: bounds.width - (sideMargin * 2),
            height: bounds.height - topOffset - sideMargin
        });
    }
}

function updateNavigationState(tabId, view) {
    if (!view) return;

    const navHistory = view.webContents.navigationHistory;

    mainWindow.webContents.send('navigation-state', {
        tabId,
        canGoBack: navHistory.canGoBack(),
        canGoForward: navHistory.canGoForward()
    });
}

// ✅ IPC: Create BrowserView
ipcMain.on('create-view', (event, tabId, url) => {
    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            plugins: true, // ✅ Enable plugins for DRM
        }
    });

    // ✅ Spotify-specific User Agent
    const spotifyUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    if (url.includes('spotify.com')) {
        view.webContents.setUserAgent(spotifyUA);
    } else {
        view.webContents.setUserAgent(DESKTOP_UA);
    }

    // ✅ Grant permissions BEFORE loading URL
    view.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'audioCapture', 'videoCapture', 'mediaKeySystem'];
        if (allowedPermissions.includes(permission)) {
            console.log('✅ Granted permission:', permission);
            callback(true);
        } else {
            callback(false);
        }
    });

    view.webContents.loadURL(url);

    // ✅ Error handler
    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode === -3) return;

        console.log(`Failed to load: ${validatedURL} - ${errorDescription} (${errorCode})`);

        const errorHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: 'Segoe UI', Tahoma, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .error-container {
                        text-align: center;
                        max-width: 500px;
                        padding: 40px;
                        background: white;
                        border-radius: 12px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    }
                    h1 { color: #d32f2f; margin-bottom: 15px; font-size: 28px; }
                    .emoji { font-size: 64px; margin-bottom: 20px; }
                    .error-code { 
                        color: #666; 
                        font-size: 13px; 
                        margin-bottom: 20px;
                        font-family: 'Courier New', monospace;
                        background: #fff3cd;
                        padding: 10px;
                        border-radius: 6px;
                    }
                    .error-url { 
                        color: #0078d4; 
                        word-break: break-all; 
                        background: #f5f5f5;
                        padding: 12px;
                        border-radius: 6px;
                        margin: 20px 0;
                        font-size: 13px;
                    }
                    p { color: #555; line-height: 1.8; margin-bottom: 15px; }
                    ul { text-align: left; color: #666; padding-left: 20px; }
                    li { margin: 8px 0; }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <div class="emoji">⚠️</div>
                    <h1>Unable to Load Page</h1>
                    <div class="error-code">${errorDescription} (Code: ${errorCode})</div>
                    <div class="error-url">${validatedURL}</div>
                    <p><strong>Possible causes:</strong></p>
                    <ul>
                        <li>Internet connection lost</li>
                        <li>Website blocked by Internet Positif</li>
                        <li>Invalid URL or website not found</li>
                        <li>SSL/TLS certificate error</li>
                    </ul>
                </div>
            </body>
            </html>
        `;

        view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
    });

    // ✅ Update UA on navigate
    view.webContents.on('will-navigate', (e, navUrl) => {
        if (navUrl.includes('spotify.com')) {
            view.webContents.setUserAgent(spotifyUA);
        }
    });

    view.webContents.on('did-navigate', (e, navUrl) => {
        if (navUrl.includes('spotify.com')) {
            view.webContents.setUserAgent(spotifyUA);
        }
        mainWindow.webContents.send('url-change', { tabId, url: navUrl });
        updateNavigationState(tabId, view);
    });

    view.webContents.on('did-navigate-in-page', (e, navUrl) => {
        mainWindow.webContents.send('url-change', { tabId, url: navUrl });
    });

    view.webContents.on('page-title-updated', (e, title) => {
        mainWindow.webContents.send('title-change', { tabId, title });
    });

    view.webContents.on('did-start-loading', () => {
        mainWindow.webContents.send('loading-start', { tabId });
    });

    view.webContents.on('did-stop-loading', () => {
        mainWindow.webContents.send('loading-stop', { tabId });
        updateNavigationState(tabId, view);
    });

    // ✅ Context menu
    view.webContents.on('context-menu', (e, params) => {
        const hasLink = !!params.linkURL;
        const hasSelection = !!(params.selectionText && params.selectionText.trim().length > 0);

        const template = [
            {
                label: 'Buka di tab baru',
                visible: hasLink,
                click: () => mainWindow.webContents.send('ctx-open-in-new-tab', params.linkURL)
            },
            {
                label: 'Buka di jendela baru',
                visible: hasLink,
                click: () => mainWindow.webContents.send('ctx-open-in-new-window', params.linkURL)
            },
            {
                type: 'separator',
                visible: hasLink || hasSelection
            },
            {
                label: 'Terjemahkan dengan Google Translate',
                visible: hasSelection,
                click: () => mainWindow.webContents.send('ctx-translate-selection', params.selectionText)
            },
            { type: 'separator' },
            {
                label: 'Inspect Element',
                click: () => {
                    view.webContents.inspectElement(params.x, params.y);
                    if (!view.webContents.isDevToolsOpened()) {
                        view.webContents.openDevTools({ mode: 'bottom' });
                    }
                }
            },
            { type: 'separator' },
            { role: 'copy', visible: params.isEditable || hasSelection },
            { role: 'paste', visible: params.isEditable },
            { role: 'selectAll' }
        ];

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: mainWindow });
    });

    // ✅ Window open handler
    view.webContents.setWindowOpenHandler((details) => {
        const url = details.url || '';

        if (url.includes('steamunlocked') || url.includes('uploadhaven.com')) {
            return { action: 'allow' };
        }

        mainWindow.webContents.send('open-url-in-new-tab', url);
        return { action: 'deny' };
    });

    views.set(tabId, view);
});

// ✅ IPC: Set active view
ipcMain.on('set-active-view', (event, tabId) => {
    const view = views.get(tabId);
    if (!view) return;

    if (activeViewId !== null) {
        const oldView = views.get(activeViewId);
        if (oldView) {
            mainWindow.removeBrowserView(oldView);
        }
    }

    mainWindow.setBrowserView(view);
    activeViewId = tabId;
    updateViewBounds();
    updateNavigationState(tabId, view);
});

// ✅ IPC: Destroy view
ipcMain.on('destroy-view', (event, tabId) => {
    const view = views.get(tabId);
    if (view) {
        mainWindow.removeBrowserView(view);
        view.webContents.destroy();
        views.delete(tabId);
    }

    if (activeViewId === tabId) {
        activeViewId = null;
    }
});

// ✅ IPC: Load URL
ipcMain.on('load-url', (event, tabId, url) => {
    const view = views.get(tabId);
    if (view) view.webContents.loadURL(url);
});

// ✅ IPC: Go Back
ipcMain.on('go-back', (event, tabId) => {
    const view = views.get(tabId);
    if (view) {
        const navHistory = view.webContents.navigationHistory;
        if (navHistory.canGoBack()) {
            view.webContents.goBack();
        }
    }
});

// ✅ IPC: Go Forward
ipcMain.on('go-forward', (event, tabId) => {
    const view = views.get(tabId);
    if (view) {
        const navHistory = view.webContents.navigationHistory;
        if (navHistory.canGoForward()) {
            view.webContents.goForward();
        }
    }
});

// ✅ IPC: Reload
ipcMain.on('reload', (event, tabId) => {
    const view = views.get(tabId);
    if (view) view.webContents.reload();
});

// ✅ IPC: DevTools
ipcMain.on('toggle-devtools', (event, tabId) => {
    const view = views.get(tabId);
    if (!view) return;

    if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools();
    } else {
        view.webContents.openDevTools({ mode: 'bottom' });
    }
});

// ✅ IPC: Hide/Show view
ipcMain.on('hide-view', (event) => {
    if (activeViewId !== null) {
        const view = views.get(activeViewId);
        if (view) {
            mainWindow.removeBrowserView(view);
        }
    }
});

ipcMain.on('show-view', (event) => {
    if (activeViewId !== null) {
        const view = views.get(activeViewId);
        if (view) {
            mainWindow.setBrowserView(view);
            updateViewBounds();
        }
    }
});

// ✅ Security handlers
app.on('web-contents-created', (event, contents) => {
    // ✅ Grant media permissions globally
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'audioCapture', 'videoCapture', 'mediaKeySystem'];
        if (allowedPermissions.includes(permission)) {
            console.log('✅ Global permission granted:', permission);
            callback(true);
        } else {
            callback(false);
        }
    });

    contents.on('will-navigate', (event, navigationUrl) => {
        try {
            const parsedUrl = new URL(navigationUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                console.log('Blocked navigation to:', navigationUrl);
                event.preventDefault();
            }
        } catch (e) {
            console.error('URL parse error:', e);
            event.preventDefault();
        }
    });

    contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            return { action: 'allow' };
        }
        return { action: 'deny' };
    });
});

// ✅ Widevine ready events
app.on('widevine-ready', (version, lastVersion) => {
    console.log('✅ Widevine CDM ready');
    console.log('Version:', version);
    console.log('Last version:', lastVersion);
});

app.on('widevine-update-pending', (currentVersion, pendingVersion) => {
    console.log('⏳ Widevine update pending');
    console.log('Current:', currentVersion, '→ Pending:', pendingVersion);
});

app.on('widevine-error', (error) => {
    console.error('❌ Widevine error:', error);
});

// ✅ App ready
app.whenReady().then(() => {
    const { session } = require('electron');

    app.userAgentFallback = DESKTOP_UA;

    console.log('Electron:', process.versions.electron);
    console.log('Chrome:', process.versions.chrome);

    // ✅ Intercept ALL Spotify requests
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://api.spotify.com/*', 'https://*.spotify.com/*', 'https://spclient.wg.spotify.com/*'] },
        (details, callback) => {
            // Override headers to match Chrome exactly
            details.requestHeaders['User-Agent'] = DESKTOP_UA;
            details.requestHeaders['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
            details.requestHeaders['sec-ch-ua-mobile'] = '?0';
            details.requestHeaders['sec-ch-ua-platform'] = '"Windows"';
            details.requestHeaders['Origin'] = 'https://open.spotify.com';

            callback({ requestHeaders: details.requestHeaders });
        }
    );

    // ✅ Log Spotify API responses for debugging
    session.defaultSession.webRequest.onHeadersReceived(
        { urls: ['https://api.spotify.com/*', 'https://spclient.wg.spotify.com/*'] },
        (details, callback) => {
            if (details.statusCode !== 200) {
                console.log('⚠️ Spotify API response:', details.url, 'Status:', details.statusCode);
            }
            callback({ cancel: false });
        }
    );

    // ✅ Certificate bypass
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        callback(0);
    });

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

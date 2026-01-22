const { app, BrowserWindow, BrowserView, Menu, ipcMain, shell, session } = require('electron');
const path = require('path');

let mainWindow;
const views = new Map();
let activeViewId = null;

// Catatan:
// - HAPUS total: ignore-certificate-errors, setCertificateVerifyProc(callback(0)), dan spoofing header sec-ch-ua.
// - Biarkan TLS verify normal (default) supaya situs login (Google) percaya. [page:3]

function isGoogleHost(hostname) {
    return (
        hostname === 'google.com' ||
        hostname.endsWith('.google.com') ||
        hostname === 'gmail.com' ||
        hostname.endsWith('.gmail.com') ||
        hostname === 'googleusercontent.com' ||
        hostname.endsWith('.googleusercontent.com')
    );
}

function safeParseUrl(raw) {
    try { return new URL(raw); } catch { return null; }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: "icon.ico",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true, // rekomendasi security Electron [page:3]
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('resize', updateViewBounds);
    mainWindow.on('closed', () => {
        views.clear();
        mainWindow = null;
    });

    // Batasi window.open dari renderer UI (index.html) juga
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // UI lokal seharusnya gak bikin popup random. Deny by default. [page:3]
        return { action: 'deny' };
    });
}

function updateViewBounds() {
    if (!mainWindow || activeViewId === null) return;

    const bounds = mainWindow.getContentBounds();
    const view = views.get(activeViewId);
    if (!view) return;

    const topOffset = 110;
    const sideMargin = 10;

    view.setBounds({
        x: sideMargin,
        y: topOffset,
        width: bounds.width - (sideMargin * 2),
        height: bounds.height - topOffset - sideMargin
    });
}

function updateNavigationState(tabId, view) {
    if (!mainWindow || !view) return;

    // Catatan: navigationHistory itu bukan API resmi di semua versi Electron;
    // tapi kamu sudah pakai. Kalau suatu saat error, ganti ke canGoBack()/canGoForward().
    mainWindow.webContents.send('navigation-state', {
        tabId,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
    });
}

function installSessionGuards(ses) {
    // Permission handler: default deny, allow yang perlu saja. [page:2][page:3]
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const wcUrl = webContents.getURL();
        const parsed = safeParseUrl(wcUrl);
        const host = parsed?.hostname || '';

        const allowList = new Set(['media', 'audioCapture', 'videoCapture', 'mediaKeySystem']);
        if (!allowList.has(permission)) return callback(false);

        // Contoh kebijakan: media hanya untuk origin https
        if (parsed?.protocol !== 'https:') return callback(false);

        // Silakan ubah ini sesuai kebutuhanmu:
        // - jika mau super ketat: hanya allow media untuk domain tertentu.
        callback(true);
    });

    // Permission check handler biar konsisten (Electron docs menyarankan implement dua-duanya) [page:2]
    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        const parsed = safeParseUrl(requestingOrigin);
        if (!parsed || parsed.protocol !== 'https:') return false;

        const allowList = new Set(['media', 'audioCapture', 'videoCapture', 'mediaKeySystem']);
        return allowList.has(permission);
    });
}

const loadingPollers = new Map(); // tabId -> intervalId

function startLoadingPoll(tabId, view) {
    stopLoadingPoll(tabId);

    const tick = () => {
        if (!mainWindow || !view || view.webContents.isDestroyed()) {
            stopLoadingPoll(tabId);
            return;
        }

        const waiting = view.webContents.isWaitingForResponse(); // nunggu respon pertama [web:167]
        const loading = view.webContents.isLoading();            // masih loading resource [web:66]

        if (waiting || loading) {
            mainWindow.webContents.send('loading-start', { tabId });
        } else {
            mainWindow.webContents.send('loading-stop', { tabId });
            stopLoadingPoll(tabId);
        }
    };

    // langsung cek sekali biar instan
    tick();
    const id = setInterval(tick, 100);
    loadingPollers.set(tabId, id);
}

function stopLoadingPoll(tabId) {
    const id = loadingPollers.get(tabId);
    if (id) clearInterval(id);
    loadingPollers.delete(tabId);
}


function createBrowserView(tabId, url) {
    const parsed = safeParseUrl(url);
    const isGoogle = parsed ? isGoogleHost(parsed.hostname) : false;

    const partition = isGoogle ? 'persist:google' : 'persist:default';
    const ses = session.fromPartition(partition); // persist session sesuai docs [page:2]

    installSessionGuards(ses);

    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            partition,
            // plugins: true // kalau gak wajib, mending jangan dinyalain (attack surface)
        }
    });

    // Jangan clearStorageData setiap bikin view Google.
    // Itu bikin login/consent loop & risk score makin tinggi.

    // Window open handler: untuk login Google, lempar ke browser eksternal (paling kompatibel)
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
        const p = safeParseUrl(popupUrl);
        if (!p) return { action: 'deny' };

        const popupIsGoogle = isGoogleHost(p.hostname);

        // Kalau Google account / oauth popup → buka external browser
        if (popupIsGoogle && p.pathname.includes('ServiceLogin')) {
            shell.openExternal(popupUrl);
            return { action: 'deny' };
        }
        if (popupIsGoogle && p.hostname === 'accounts.google.com') {
            shell.openExternal(popupUrl);
            return { action: 'deny' };
        }

        // Selain itu: bikin tab baru di app (lebih aman daripada allow popup)
        mainWindow?.webContents.send('open-url-in-new-tab', popupUrl);
        return { action: 'deny' };
    });

    // Limit navigation: cuma http/https. (punyamu udah ada, ini versi rapih)
    view.webContents.on('will-navigate', (event, navigationUrl) => {
        const p = safeParseUrl(navigationUrl);
        if (!p) return event.preventDefault();
        if (p.protocol !== 'http:' && p.protocol !== 'https:') event.preventDefault();
    });

    // Events UI sync
    view.webContents.on('did-navigate', (_e, navUrl) => {
        mainWindow?.webContents.send('url-change', { tabId, url: navUrl });
        updateNavigationState(tabId, view);
    });

    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
        mainWindow?.webContents.send('url-change', { tabId, url: navUrl });
    });

    view.webContents.on('page-title-updated', (_e, title) => {
        mainWindow?.webContents.send('title-change', { tabId, title });
    });

    view.webContents.on('did-start-navigation', (event, navUrl, isInPlace, isMainFrame) => {
        if (!isMainFrame) return;
        // nyala dari awal dan keep nyala selama waiting/loading
        startLoadingPoll(tabId, view);
    });

    view.webContents.on('did-start-loading', () => {
        // fallback: kalau ada load yang bukan navigation (misal reload)
        startLoadingPoll(tabId, view);
    });

    view.webContents.on('did-stop-loading', () => {
        mainWindow?.webContents.send('loading-stop', { tabId });
        stopLoadingPoll(tabId);
        updateNavigationState(tabId, view);
    });

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode === -3) return;
        mainWindow?.webContents.send('loading-stop', { tabId });
        stopLoadingPoll(tabId);
        loadErrorPage(view, { /* ...punyamu... */ });
    });



    // Context menu (punyamu oke; tetap local UI yang trigger, aman)
    view.webContents.on('context-menu', (e, params) => {
        const hasLink = !!params.linkURL;
        const hasSelection = !!(params.selectionText && params.selectionText.trim().length > 0);

        const template = [
            {
                label: 'Buka di tab baru',
                visible: hasLink,
                click: () => mainWindow?.webContents.send('ctx-open-in-new-tab', params.linkURL)
            },
            {
                label: 'Buka di jendela baru (browser default)',
                visible: hasLink,
                click: () => {
                    // Jangan langsung openExternal untuk URL aneh; minimal cek http/https dulu. [page:3]
                    const p = safeParseUrl(params.linkURL);
                    if (p && (p.protocol === 'http:' || p.protocol === 'https:')) shell.openExternal(params.linkURL);
                }
            },
            { type: 'separator', visible: hasLink || hasSelection },
            {
                label: 'Terjemahkan dengan Google Translate',
                visible: hasSelection,
                click: () => mainWindow?.webContents.send('ctx-translate-selection', params.selectionText)
            },
            { type: 'separator' },
            {
                label: 'Inspect Element',
                click: () => {
                    view.webContents.inspectElement(params.x, params.y);
                    if (!view.webContents.isDevToolsOpened()) view.webContents.openDevTools({ mode: 'bottom' });
                }
            },
            { type: 'separator' },
            { role: 'copy', visible: params.isEditable || hasSelection },
            { role: 'paste', visible: params.isEditable },
            { role: 'selectAll' }
        ];

        Menu.buildFromTemplate(template).popup({ window: mainWindow });
    });

    view.webContents.loadURL(url);
    return view;
}

function loadErrorPage(view, {
    title = 'Unable to Load Page',
    subtitle = 'An error occurred while loading the page.',
    url = '',
    errorCode = '',
    errorDescription = '',
    tips = [],
} = {}) {
    const safeUrl = String(url || '');
    const safeDesc = String(errorDescription || '');
    const safeCode = String(errorCode || '');

    const tipsHtml = tips.map(t => `<li>${String(t)}</li>`).join('');

    const errorHTML = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    *{box-sizing:border-box} body{margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#0b1220;color:#e5e7eb}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:720px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:14px;padding:22px}
    h1{margin:0 0 8px;font-size:22px} p{margin:6px 0;color:#cbd5e1;line-height:1.6}
    .meta{margin-top:14px;padding:12px;border-radius:10px;background:#0b1020;border:1px solid #1f2937;font-family:Consolas,monospace;font-size:12px;color:#d1d5db}
    ul{margin:10px 0 0 18px;color:#cbd5e1}
    .btnrow{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
    button{cursor:pointer;border:1px solid #374151;background:#1f2937;color:#e5e7eb;padding:10px 12px;border-radius:10px}
    button:hover{background:#243041}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${title}</h1>
      <p>${subtitle}</p>

      <div class="meta">
        URL: ${safeUrl}<br/>
        Error: ${safeDesc}<br/>
        Code: ${safeCode}
      </div>

      ${tips.length ? `<p><b>Possible causes:</b></p><ul>${tipsHtml}</ul>` : ''}
    </div>
  </div>
</body>
</html>`;

    view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
}


// IPC: Create BrowserView
ipcMain.on('create-view', (_event, tabId, url) => {
    const view = createBrowserView(tabId, url);
    views.set(tabId, view);
});

// Switch view
ipcMain.on('set-active-view', (_event, tabId) => {
    const view = views.get(tabId);
    if (!view || !mainWindow) return;

    if (activeViewId !== null) {
        const oldView = views.get(activeViewId);
        if (oldView) mainWindow.removeBrowserView(oldView);
    }

    mainWindow.setBrowserView(view);
    activeViewId = tabId;
    updateViewBounds();
    updateNavigationState(tabId, view);
});

ipcMain.on('destroy-view', (_event, tabId) => {
    const view = views.get(tabId);
    if (view && mainWindow) {
        mainWindow.removeBrowserView(view);
        view.webContents.destroy();
        views.delete(tabId);
    }
    if (activeViewId === tabId) activeViewId = null;

    stopLoadingPoll(tabId);

});

ipcMain.on('load-url', (_event, tabId, url) => {
    const view = views.get(tabId);
    if (view) view.webContents.loadURL(url);
});

ipcMain.on('go-back', (_event, tabId) => {
    const view = views.get(tabId);
    if (view && view.webContents.canGoBack()) view.webContents.goBack();
});

ipcMain.on('go-forward', (_event, tabId) => {
    const view = views.get(tabId);
    if (view && view.webContents.canGoForward()) view.webContents.goForward();
});

ipcMain.on('reload', (_event, tabId) => {
    const view = views.get(tabId);
    if (view) view.webContents.reload();
});

ipcMain.on('toggle-devtools', (_event, tabId) => {
    const view = views.get(tabId);
    if (!view) return;
    if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools();
    else view.webContents.openDevTools({ mode: 'bottom' });
});

ipcMain.on('hide-view', () => {
    if (!mainWindow || activeViewId === null) return;
    const view = views.get(activeViewId);
    if (view) mainWindow.removeBrowserView(view);
});

ipcMain.on('show-view', () => {
    if (!mainWindow || activeViewId === null) return;
    const view = views.get(activeViewId);
    if (view) {
        mainWindow.setBrowserView(view);
        updateViewBounds();
    }
});

// App lifecycle
app.whenReady().then(async () => {
    // 1) Reset & pakai proxy sistem (biar ngikut WARP)
    await session.defaultSession.forceReloadProxyConfig(); // reset internal state [web:36]
    await session.defaultSession.setProxy({ mode: 'system' }); // ikut OS [web:126]

    // 2) Lakukan juga untuk partition yang kamu pakai
    const sesDefault = session.fromPartition('persist:default');
    await sesDefault.forceReloadProxyConfig(); // [web:36]
    await sesDefault.setProxy({ mode: 'system' }); // [web:126]

    const sesGoogle = session.fromPartition('persist:google');
    await sesGoogle.forceReloadProxyConfig(); // [web:36]
    await sesGoogle.setProxy({ mode: 'system' }); // [web:126]

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
        // Default Electron: block. Kita pertahankan block (callback(false)),
        // tapi kita tampilkan error page biar user paham. [web:56]
        event.preventDefault();
        callback(false);

        // Tampilkan halaman error di tab itu (kalau masih hidup)
        try {
            const view = BrowserView.fromWebContents(webContents);
            if (view) {
                loadErrorPage(view, {
                    title: 'SSL/TLS Certificate Error',
                    subtitle: "The site's certificate is invalid. This often occurs because the network/ISP is intercepting it or the site is experiencing issues.",
                    url,
                    errorCode: error,
                    errorDescription: error,
                    tips: [
                        'Try turning on a VPN/changing networks.',
                        'Check if your proxy/antivirus is running HTTPS scanning.',
                        'Do not proceed if this is an important login/account page.'
                    ]
                });
            }
        } catch (_) { }
    });

});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

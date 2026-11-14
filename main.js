const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, globalShortcut,
  safeStorage, systemPreferences, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const archive = require('./lib/archive');
const { GitHub } = require('./lib/github');
const { Crawler } = require('./lib/crawler');

if (process.env.MT_USERDATA) app.setPath('userData', process.env.MT_USERDATA);

const DEFAULT_SYNC = { owner: 'Rowan-Achterberg', repo: 'minitune', branch: 'userdata' };
const SIZE = { w: 360, h: 580, mini: 92 };
const HOTKEY = 'Control+Alt+M';
const MAX_SONG = 40 * 1024 * 1024;

let win, tray, quitting = false, mini = false, normalBounds = null;
const xfetch = (url, opt) => net.fetch(url, opt);
const file = (name) => path.join(app.getPath('userData'), name);
const musicDir = () => path.join(app.getPath('music'), 'MiniTune');

async function readJson(p, fallback) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJson(p, data) {
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, p);
}

// ───────── GitHub 配置（令牌用系统凭据加密后存在本机，不进仓库） ─────────
async function loadSync() {
  const c = await readJson(file('sync.json'), {});
  let token = '';
  if (c.token) {
    try {
      token = c.enc ? safeStorage.decryptString(Buffer.from(c.token, 'base64')) : c.token;
    } catch { token = ''; }
  }
  return { ...DEFAULT_SYNC, ...c, token, enc: undefined };
}
async function saveSync(cfg) {
  const out = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || DEFAULT_SYNC.branch };
  if (cfg.token) {
    if (safeStorage.isEncryptionAvailable()) {
      out.token = safeStorage.encryptString(cfg.token).toString('base64'); out.enc = true;
    } else out.token = cfg.token;
  }
  await writeJson(file('sync.json'), out);
}
let gh = null;
async function github() {
  if (!gh) gh = new GitHub(await loadSync(), xfetch);
  return gh;
}

// ───────── 本地音乐扫描 ─────────
const AUDIO = /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i;
async function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (AUDIO.test(e.name)) out.push(p);
  }
}
let tagCache = null;
async function readTrack(p) {
  let st;
  try { st = await fsp.stat(p); } catch { return null; }
  const sig = st.size + ':' + Math.round(st.mtimeMs);
  const hit = tagCache[p];
  if (hit && hit.sig === sig) return hit.t;
  const base = path.basename(p).replace(AUDIO, '');
  const m = /^(.+?)\s+-\s+(.+)$/.exec(base); // "歌手 - 歌名"
  const t = {
    id: 'local:' + crypto.createHash('sha1').update(p).digest('hex').slice(0, 16),
    src: 'local', path: p,
    title: m ? m[2] : base, artist: m ? m[1] : '', album: path.basename(path.dirname(p)),
    no: 0, dur: 0, kbps: 0,
  };
  try {
    const mm = require('music-metadata');
    const meta = await mm.parseFile(p, { duration: false, skipCovers: true });
    const c = meta.common, f = meta.format;
    if (c.title) t.title = c.title;
    if (c.artist || c.albumartist) t.artist = c.artist || c.albumartist;
    if (c.album) t.album = c.album;
    t.no = c.track?.no || 0;
    t.genre = (c.genre || []).join(' ').slice(0, 80);
    t.year = c.year || 0;
    t.dur = Math.round(f.duration || 0);
    t.kbps = f.lossless ? 1411 : Math.round((f.bitrate || 0) / 1000);
  } catch { /* 读不到标签就用文件名 */ }
  tagCache[p] = { sig, t };
  return t;
}
async function scan(folders) {
  if (!tagCache) tagCache = await readJson(file('tags.json'), {});
  const files = [];
  for (const d of folders) await walk(d, files);
  const tracks = [];
  for (const p of [...new Set(files)]) { const t = await readTrack(p); if (t) tracks.push(t); }
  const keep = {};
  for (const t of tracks) keep[t.path] = tagCache[t.path];
  tagCache = keep;
  writeJson(file('tags.json'), tagCache).catch(() => {});
  return tracks;
}

// ───────── 下载 / 播放地址 ─────────
const safeName = (s) => String(s).replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
function songFile(t) {
  const h = crypto.createHash('sha1').update(t.id).digest('hex').slice(0, 6);
  const ext = (/\.(mp3|ogg|oga|m4a|flac|wav)(?:\?|$)/i.exec(t.url || '') || [])[1] || 'mp3';
  return safeName(`${t.artist || '未知歌手'} - ${t.title || '未命名'}`) + ` [${h}].${ext.toLowerCase()}`;
}
const exists = (p) => fsp.access(p).then(() => true, () => false);

async function resolveMedia(t) {
  if (t.src === 'local') return (await exists(t.path)) ? pathToFileURL(t.path).href : null;
  if (t.gh) {
    const local = path.join(musicDir(), path.basename(t.gh));
    if (await exists(local)) return pathToFileURL(local).href;
    try { // 另一台电脑下载过：从 GitHub 取回本机
      const g = await github();
      if (g.ready) {
        const buf = await g.getRaw(t.gh);
        await fsp.mkdir(musicDir(), { recursive: true });
        await fsp.writeFile(local, buf);
        return pathToFileURL(local).href;
      }
    } catch { /* 取不到就退回原始地址 */ }
  }
  return t.url || null;
}

async function download(t) {
  const r = await xfetch(t.url);
  if (!r.ok) throw new Error('下载失败 ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 10000) throw new Error('文件不完整');
  const name = songFile(t);
  await fsp.mkdir(musicDir(), { recursive: true });
  await fsp.writeFile(path.join(musicDir(), name), buf);
  const g = await github();
  if (!g.ready) return { saved: true, gh: null, note: '已保存到本机（未设置 GitHub 同步）' };
  if (buf.length > MAX_SONG) return { saved: true, gh: null, note: '文件超过 40MB，仅保存到本机' };
  await g.uploadSong('music/' + name, buf);
  return { saved: true, gh: 'music/' + name };
}

// ───────── 窗口 / 托盘 / 隐藏 ─────────
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else { win.show(); win.focus(); }
}
function accent() {
  try { return '#' + systemPreferences.getAccentColor().slice(0, 6); } catch { return null; }
}

function createWindow(saved) {
  const b = saved?.bounds || {};
  win = new BrowserWindow({
    width: b.width || SIZE.w, height: b.height || SIZE.h, x: b.x, y: b.y,
    minWidth: 320, minHeight: SIZE.mini, maxWidth: 520,
    frame: false, show: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#202020',
    alwaysOnTop: !!saved?.pin,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  if (process.env.MT_SHOT) { // 开发用：启动后截图并退出
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.MT_EVAL) await win.webContents.executeJavaScript(process.env.MT_EVAL).catch(console.error);
      await new Promise((r) => setTimeout(r, 600));
      const img = await win.webContents.capturePage();
      await fsp.writeFile(process.env.MT_SHOT, img.toPNG());
      quitting = true; app.quit();
    }, 1800));
  }
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('MiniTune');
    const send = (type) => () => win?.webContents.send('cmd', { type });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏　Ctrl+Alt+M', click: toggleWindow },
      { type: 'separator' },
      { label: '播放 / 暂停', click: send('toggle') },
      { label: '上一首', click: send('prev') },
      { label: '下一首', click: send('next') },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', toggleWindow);
  } catch { tray = null; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    const st = await readJson(file('state.json'), null);
    createWindow(st?.win);
    createTray();
    globalShortcut.register(HOTKEY, toggleWindow);
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}

// ───────── IPC ─────────
const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

h('state:load', () => readJson(file('state.json'), null));
h('state:save', (s) => {
  if (win && !mini) s.win = { ...(s.win || {}), bounds: win.getBounds() };
  else if (normalBounds) s.win = { ...(s.win || {}), bounds: normalBounds };
  return writeJson(file('state.json'), s);
});
h('win:hide', () => { if (tray) win.hide(); else win.minimize(); return !!tray; });
h('win:minimize', () => win.minimize());
h('win:pin', (on) => win.setAlwaysOnTop(!!on));
h('win:mini', (on) => {
  if (on && !mini) { normalBounds = win.getBounds(); win.setMinimumSize(320, SIZE.mini); win.setSize(normalBounds.width, SIZE.mini); }
  if (!on && mini && normalBounds) win.setSize(normalBounds.width, Math.max(normalBounds.height, 300));
  mini = !!on;
});
h('sys:info', () => ({ accent: accent(), hotkey: 'Ctrl+Alt+M', musicDir: musicDir(), version: app.getVersion() }));
h('sys:open', (url) => /^https:\/\//.test(url) && shell.openExternal(url));
h('sys:showMusicDir', async () => { await fsp.mkdir(musicDir(), { recursive: true }); return shell.openPath(musicDir()); });

h('local:defaultFolder', () => app.getPath('music'));
h('local:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: '选择音乐文件夹', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
h('local:scan', (folders) => scan(folders));

const crawler = new Crawler({
  fetch: xfetch,
  load: () => readJson(file('crawler.json'), null),
  save: (st) => writeJson(file('crawler.json'), st),
  emit: (msg) => { if (win && !win.isDestroyed()) win.webContents.send('cmd', msg); },
});
h('crawl:set', (cfg) => crawler.configure(cfg));
h('crawl:boost', (kw) => crawler.boost(kw));
h('online:verify', (urls) => archive.verifyAll(xfetch, urls));

h('media:resolve', resolveMedia);
h('media:download', download);

h('sync:get', async () => { const c = await loadSync(); return { owner: c.owner, repo: c.repo, branch: c.branch, hasToken: !!c.token }; });
h('sync:set', async (cfg) => {
  const cur = await loadSync();
  const next = { ...cur, ...cfg, token: cfg.token || cur.token };
  const g = new GitHub(next, xfetch);
  await g.test();
  await saveSync(next);
  gh = g;
  return true;
});
h('sync:clear', async () => { const c = await loadSync(); await saveSync({ ...c, token: '' }); gh = null; return true; });
h('sync:run', async (local) => {
  const g = await github();
  if (!g.ready) return null;
  return g.sync(local);
});

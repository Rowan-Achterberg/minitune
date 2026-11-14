/* global Names, api */
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, fill) => `<svg viewBox="0 0 16 16"${fill ? ' style="fill:currentColor;stroke:none"' : ''}><path d="${d}"/></svg>`;
const IC = {
  search: svg('M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3'),
  sync: svg('M13 8a5 5 0 0 1-9 3M3 8a5 5 0 0 1 9-3M12 2v3H9M4 14v-3h3'),
  set: svg('M2 4h7M13 4h1M2 8h2M8 8h6M2 12h5M11 12h3M11 2.5v3M6 6.5v3M9 10.5v3'),
  pin: svg('M8 10v4M5 10h6M6 10V3h4v7M5 3h6'),
  mini: svg('M2 3h12v10H2zM8 8h6v5H8z'),
  min: svg('M3 8h10'),
  close: svg('M3.5 3.5l9 9M12.5 3.5l-9 9'),
  play: svg('M5 2.5l9 5.5-9 5.5z', 1),
  pause: svg('M4 2.5h3v11H4zM9 2.5h3v11H9z', 1),
  prev: svg('M12 3L6 8l6 5zM4 3v10'),
  next: svg('M4 3l6 5-6 5zM12 3v10'),
  all: svg('M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2'),
  one: svg('M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2M8 6.5v3'),
  shuffle: svg('M2 4h2.5c3 0 4 8 7 8H14M12 10l2 2-2 2M2 12h2.5c1 0 1.7-.8 2.3-1.9M9.2 5.9C9.8 4.8 10.5 4 11.5 4H14M12 2l2 2-2 2'),
  heart: svg('M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.3C13.5 10 8 13.5 8 13.5z'),
  plus: svg('M8 3v10M3 8h10'),
  down: svg('M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10'),
  check: svg('M3 8.5l3.5 3.5L13 5'),
  back: svg('M10 3L5 8l5 5'),
  up: svg('M4 10l4-4 4 4'),
  spin: svg('M8 2a6 6 0 1 0 6 6'),
  edit: svg('M3 13l1-3 7-7 2 2-7 7zM10 4l2 2'),
};
const LOOPS = { all: '列表循环', one: '单曲循环', shuffle: '随机播放' };
const AUTO = [
  { id: '@dl', name: '已下载', glyph: IC.down, color: '#107C10' },
  { id: '@zh', name: '中文', glyph: '中', color: '#C50F1F' },
  { id: '@en', name: '英文', glyph: 'En', color: '#0078D4' },
  { id: '@song', name: '歌曲', glyph: '歌', color: '#8764B8' },
  { id: '@instr', name: '纯音乐', glyph: '乐', color: '#038387' },
  { id: '@classic', name: '经典', glyph: '典', color: '#CA5010' },
];
const COLORS = ['#0078D4', '#8764B8', '#038387', '#CA5010', '#C239B3', '#498205', '#69797E'];

// ───────── 状态 ─────────
let S = {
  folders: [], local: [], online: [],
  playlists: [{ id: 'fav', name: '我喜欢', createdAt: 0, updatedAt: 0, tracks: [] }],
  deleted: {}, onlineDeleted: {}, keywords: [], kwUpdatedAt: 0, sites: [],
  dead: {}, chk: {}, fail: {},
  set: { sort: 'surname', loop: 'all', vol: 80, auto: true, tab: 'local', pin: false, trayHint: false },
};
let tab = 'local', plOpen = null, query = '', view = [], limit = 300;
let queue = [], qi = -1, cur = null, errStreak = 0;
let info = {}, syncCfg = { hasToken: false }, crawlText = '';
let dirty = 0, syncing = false, syncTimer = null, saveTimer = null;
const downloading = new Set();
const audio = new Audio();

let localByPath = new Map(), localByKey = new Map(), onlineById = new Map(), pool = [];
const catCache = new WeakMap();
const cats = (t) => { let c = catCache.get(t); if (!c) { c = Names.categories(t); catCache.set(t, c); } return c; };
const pyCache = new WeakMap();
const py = (t) => { let c = pyCache.get(t); if (!c) { c = [Names.initials(t.title), Names.initials(t.artist)]; pyCache.set(t, c); } return c; };

function reindex() {
  localByPath = new Map(S.local.map((t) => [t.path, t]));
  localByKey = new Map(S.local.map((t) => [Names.key(t), t]));
  onlineById = new Map(S.online.map((t) => [t.id, t]));
  pool = Names.dedupe([...S.local, ...S.online]);
}
const fav = () => S.playlists.find((p) => p.id === 'fav');
const pl = (id) => S.playlists.find((p) => p.id === id);
const isFav = (t) => fav().tracks.some((x) => x.id === t.id);
const slim = (t) => ({ id: t.id, src: t.src, item: t.item, url: t.url, path: t.path, title: t.title, artist: t.artist, album: t.album, no: t.no, dur: t.dur, kbps: t.kbps, gh: t.gh, genre: t.genre, year: t.year });

// 歌单里的歌换算成“这台电脑上能播放的那一首”；不能播放的返回 null（不显示）
function playable(t) {
  if (t.src === 'local') return localByPath.get(t.path) || localByKey.get(Names.key(t)) || null;
  const o = onlineById.get(t.id) || t;
  return S.dead[o.id] && !o.gh ? null : o;
}
function tracksOf(id) {
  if (id === '@dl') return S.online.filter((t) => t.gh);
  if (id[0] === '@') return pool.filter((t) => cats(t).includes(id.slice(1)));
  return (pl(id)?.tracks || []).map(playable).filter(Boolean);
}

function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => api.saveState(S).catch(() => {}), 800); }
function changed() { dirty++; save(); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 8000); }

function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms);
}
const fmt = (s) => (s > 0 ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00');

// ───────── 列表 ─────────
function searchResults() {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qp = Names.initials(q);
  const hits = [];
  for (const t of pool) {
    const title = (t.title || '').toLowerCase(), artist = (t.artist || '').toLowerCase();
    const [pt, pa] = py(t);
    let score = -1;
    if (title.startsWith(q) || (qp && pt.startsWith(qp))) score = 0;
    else if (artist.startsWith(q) || (qp && pa.startsWith(qp))) score = 1;
    else if (title.includes(q) || artist.includes(q) || (t.album || '').toLowerCase().includes(q)) score = 2;
    else if (qp.length > 1 && (pt.includes(qp) || pa.includes(qp))) score = 3;
    if (score >= 0) hits.push([score, t]);
  }
  hits.sort((a, b) => a[0] - b[0] || Names.cmp(a[1].title, b[1].title));
  return hits.slice(0, 300).map((h) => h[1]);
}

function computeView() {
  if (tab === 'search') return searchResults();
  let list = tab === 'local' ? S.local : tab === 'online' ? S.online : plOpen ? tracksOf(plOpen) : [];
  return Names.sortTracks(Names.dedupe(list), S.set.sort);
}

function rowHtml(t, i) {
  const on = cur && cur.id === t.id;
  const liked = isFav(t);
  const sub = [t.artist || '未知歌手', t.album].filter(Boolean).join(' · ');
  const online = t.src !== 'local';
  const inPl = tab === 'pl' && plOpen && plOpen[0] !== '@';
  let acts = `<button class="act${liked ? ' liked' : ''}" data-a="fav" title="${liked ? '取消喜欢' : '喜欢'}">${IC.heart}</button>` +
    `<button class="act" data-a="add" title="加入歌单">${IC.plus}</button>`;
  if (online && !t.gh) acts += `<button class="act${downloading.has(t.id) ? ' busy' : ''}" data-a="dl" title="下载并保存到 GitHub">${downloading.has(t.id) ? IC.spin : IC.down}</button>`;
  if (inPl || tab === 'online') acts += `<button class="act" data-a="rm" title="${inPl ? '移出歌单' : '不再显示'}">${IC.close}</button>`;
  return `<div class="row${on ? ' on' : ''}" data-i="${i}">` +
    `<div class="t"><div class="t1">${esc(t.title)}</div><div class="t2">${esc(sub)}</div></div>` +
    (t.gh ? `<span class="mark" title="已下载">${IC.check}</span>` : '') +
    (liked ? `<span class="mark">${IC.heart}</span>` : '') +
    `<span class="q">${t.dur ? fmt(t.dur) : t.kbps ? t.kbps + 'k' : ''}</span>` +
    `<div class="acts">${acts}</div></div>`;
}

function tile(id, name, count, glyph, color, extra = '') {
  return `<button class="tile${extra}" data-pl="${esc(id)}"><div class="art" style="background:${color}">${glyph}</div>` +
    `<div class="n">${esc(name)}</div><div class="c">${count}</div></button>`;
}
function gridHtml() {
  const f = fav();
  let h = '<div class="sec">我的歌单</div><div class="grid">' +
    tile('fav', f.name, tracksOf('fav').length + ' 首', IC.heart, 'var(--accent);color:var(--on-accent)');
  S.playlists.filter((p) => p.id !== 'fav').forEach((p, i) => {
    h += tile(p.id, p.name, tracksOf(p.id).length + ' 首', esc([...p.name][0] || '♪'), COLORS[i % COLORS.length]);
  });
  h += `<button class="tile new" data-pl="+"><div class="art">${IC.plus}</div><div class="n">新建歌单</div><div class="c">&nbsp;</div></button></div>`;
  h += '<div class="sec">自动分类</div><div class="grid">';
  for (const a of AUTO) h += tile(a.id, a.name, tracksOf(a.id).length + ' 首', a.glyph, a.color);
  return h + '</div>';
}

function emptyHtml() {
  if (tab === 'local') return '<div class="empty"><b>还没有本地音乐</b>点“添加文件夹”选择放歌的文件夹</div>';
  if (tab === 'online') return `<div class="empty"><b>正在网上寻找免费音乐</b>${S.set.auto ? '找到并确认能播放的歌曲会自动出现在这里' : '打开“持续搜索”开始寻找'}</div>`;
  if (tab === 'search') return query.trim()
    ? '<div class="empty"><b>曲库里没有匹配的歌</b>按回车到网上搜索</div>'
    : '<div class="empty"><b>搜索</b>输入第一个字母就开始匹配<br>支持拼音首字母，例如 zjl</div>';
  return '<div class="empty"><b>这个歌单还是空的</b>在任意歌曲上点 ♥ 或 ＋ 加进来</div>';
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('.search').hidden = tab !== 'search';
  $('#bAuto').hidden = tab !== 'online';
  $('#bAuto').classList.toggle('on', !!S.set.auto);
  $('#bAdd').hidden = tab !== 'local';
  $('#bar').hidden = tab === 'pl';
  $('#hint').hidden = tab === 'search';
  $('#sort').hidden = tab === 'search' || (tab === 'pl' && !plOpen);

  const head = $('#pls');
  if (tab === 'pl' && plOpen) {
    const p = pl(plOpen), a = AUTO.find((x) => x.id === plOpen);
    head.innerHTML = `<button class="act" data-h="back" title="返回">${IC.back}</button>` +
      `<div class="name">${esc(p ? p.name : a.name)}<span class="count" id="plCount"></span></div>` +
      `<button class="chip on" data-h="playall">播放全部</button>` +
      (p && p.id !== 'fav' ? `<button class="act" data-h="rename" title="重命名">${IC.edit}</button><button class="act" data-h="del" title="删除歌单">${IC.close}</button>` : '');
  } else head.innerHTML = '';

  const list = $('#list');
  if (tab === 'pl' && !plOpen) { view = []; list.innerHTML = gridHtml(); $('#hint').textContent = ''; return; }

  view = computeView();
  const mode = tab === 'search' ? '' : S.set.sort;
  let html = '', g = null;
  const n = Math.min(view.length, limit);
  for (let i = 0; i < n; i++) {
    const t = view[i];
    const tg = mode ? Names.groupOf(t, mode) : '';
    if (tg && tg !== g) { g = tg; html += `<div class="group">${esc(g)}</div>`; }
    html += rowHtml(t, i);
  }
  if (!view.length) html = emptyHtml();
  if (tab === 'search' && query.trim()) html += `<button class="btn webgo" data-web="1">到网上搜索 “${esc(query.trim())}”</button>`;
  list.innerHTML = html;

  if ($('#plCount')) $('#plCount').textContent = view.length + ' 首';
  $('#hint').textContent = tab === 'local' ? `${view.length} 首` :
    tab === 'online' ? (crawlText || `${view.length} 首可播放`) : '';
  $('#hint').title = $('#hint').textContent;
}
let renderT = 0;
function renderSoon() { if (!renderT) renderT = setTimeout(() => { renderT = 0; render(); }, 1500); }

// ───────── 歌单操作 ─────────
function touch(p) { p.updatedAt = Date.now(); changed(); }
function toggleFav(t) {
  const f = fav(), i = f.tracks.findIndex((x) => x.id === t.id);
  if (i >= 0) f.tracks.splice(i, 1); else f.tracks.push(slim(t));
  touch(f); render(); updateNow();
}
function addTo(id, t) {
  const p = pl(id);
  if (p.tracks.some((x) => x.id === t.id)) return toast('已经在“' + p.name + '”里了');
  p.tracks.push(slim(t)); touch(p); toast('已加入“' + p.name + '”'); render();
}
async function newPlaylist(t) {
  const name = await ask('新建歌单', '');
  if (!name) return;
  const p = { id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, createdAt: Date.now(), updatedAt: Date.now(), tracks: t ? [slim(t)] : [] };
  S.playlists.push(p); changed(); render();
}
function removeOnline(t) {
  S.online = S.online.filter((x) => x.id !== t.id);
  S.onlineDeleted[t.id] = Date.now();
  reindex(); changed();
}

// ───────── 在线曲库：重名只留最好的 ─────────
function addOnline(tracks) {
  const byKey = new Map(S.online.map((t, i) => [Names.key(t), i]));
  let n = 0;
  for (const t of tracks) {
    if (S.onlineDeleted[t.id] || onlineById.has(t.id)) continue;
    const k = Names.key(t), i = byKey.get(k);
    if (i === undefined) { byKey.set(k, S.online.push(t) - 1); n++; }
    else if (!S.online[i].gh && Names.better(t, S.online[i])) { // 找到音质更好的：替换掉旧的
      const old = S.online[i];
      S.online[i] = t; n++;
      for (const p of S.playlists) {
        const j = p.tracks.findIndex((x) => x.id === old.id);
        if (j >= 0) { p.tracks[j] = slim(t); p.updatedAt = Date.now(); }
      }
      if (cur && cur.id === old.id) cur = { ...cur, id: t.id };
    }
    S.chk[t.id] = Date.now();
  }
  if (S.online.length > 3000) S.online.length = 3000;
  if (n) { reindex(); changed(); renderSoon(); }
  return n;
}

// 后台体检：定期复查地址，失效的自动撤下，保证列表里的都能播放
async function healthCheck() {
  if (!navigator.onLine) return;
  const now = Date.now(), seen = new Set(), cand = [];
  const push = (t) => { if (t.src !== 'local' && t.url && !seen.has(t.id)) { seen.add(t.id); cand.push(t); } };
  S.online.forEach(push);
  S.playlists.forEach((p) => p.tracks.forEach(push));
  const batch = cand.filter((t) => now - (S.chk[t.id] || 0) > 3 * 24 * 3600e3)
    .sort((a, b) => (S.chk[a.id] || 0) - (S.chk[b.id] || 0)).slice(0, 5);
  if (!batch.length) return;
  let ok;
  try { ok = await api.verify(batch.map((t) => t.url)); } catch { return; }
  if (batch.length >= 3 && !ok.some(Boolean)) return; // 全部失败多半是网络问题，不算数
  let removed = false;
  batch.forEach((t, i) => {
    if (ok[i]) { S.chk[t.id] = now; delete S.fail[t.id]; delete S.dead[t.id]; return; }
    S.fail[t.id] = (S.fail[t.id] || 0) + 1;
    S.chk[t.id] = now - 3 * 24 * 3600e3 + 3600e3; // 一小时后再确认一次
    if (S.fail[t.id] >= 2) { S.dead[t.id] = 1; if (!t.gh && onlineById.has(t.id)) { removeOnline(t); removed = true; } }
  });
  save();
  if (removed) renderSoon();
}

// ───────── 播放 ─────────
function setIcon() { $('#bPlay').innerHTML = audio.paused ? IC.play : IC.pause; }
function updateNow() {
  $('#pTitle').textContent = cur ? cur.title : '未在播放';
  $('#pArtist').textContent = cur ? [cur.artist || '未知歌手', cur.album].filter(Boolean).join(' · ') : '选一首歌开始';
  const c = $('#cover');
  c.querySelector('span').textContent = cur ? [...(cur.artist || cur.title || '♪')][0].toUpperCase() : '♪';
  const img = c.querySelector('img');
  if (cur && cur.item) { img.hidden = false; img.src = 'https://archive.org/services/img/' + encodeURIComponent(cur.item); } else { img.hidden = true; img.removeAttribute('src'); }
  $('#bFav').classList.toggle('liked', !!cur && isFav(cur));
  $('#bFav').innerHTML = IC.heart;
  $('#bLoop').innerHTML = IC[S.set.loop]; $('#bLoop').title = LOOPS[S.set.loop];
  setIcon();
  if (cur && 'mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.artist || '', album: cur.album || '' });
}

async function playAt(i) {
  if (!queue.length) return;
  qi = (i + queue.length) % queue.length;
  cur = queue[qi];
  updateNow(); highlight();
  let url = null;
  try { url = await api.resolve(slim(cur)); } catch { /* 当作无法播放 */ }
  if (cur !== queue[qi]) return; // 期间又切歌了
  if (!url) return playFailed();
  audio.src = url;
  audio.play().catch(() => {});
}
function highlight() {
  document.querySelectorAll('#list .row').forEach((r) => r.classList.toggle('on', !!cur && view[+r.dataset.i]?.id === cur.id));
}
function playFailed() {
  const t = cur;
  if (t && t.src !== 'local' && navigator.onLine) { // 播不了的立刻撤下
    S.dead[t.id] = 1;
    if (!t.gh && onlineById.has(t.id)) removeOnline(t);
    renderSoon();
  }
  if (++errStreak > 5 || queue.length < 2) { errStreak = 0; toast('这首歌暂时无法播放'); setIcon(); return; }
  step(1, true);
}
function step(d, auto) {
  if (!queue.length) return;
  if (S.set.loop === 'shuffle' && queue.length > 1) {
    let n; do { n = Math.floor(Math.random() * queue.length); } while (n === qi);
    return playAt(n);
  }
  if (auto && S.set.loop === 'one' && !errStreak) { audio.currentTime = 0; return audio.play(); }
  playAt(qi + d);
}
function toggle() {
  if (!cur) { if (view.length) { queue = view.slice(); playAt(0); } return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
const setP = (el, p) => el.style.setProperty('--p', p + '%');

audio.addEventListener('playing', () => { errStreak = 0; });
audio.addEventListener('play', setIcon);
audio.addEventListener('pause', setIcon);
audio.addEventListener('ended', () => step(1, true));
audio.addEventListener('error', () => { if (audio.src) playFailed(); });
audio.addEventListener('timeupdate', () => {
  if (seeking) return;
  const d = audio.duration || 0, p = d ? (audio.currentTime / d) * 100 : 0;
  $('#prog').value = p * 10; setP($('#prog'), p);
  $('#player').style.setProperty('--pp', p + '%');
  $('#tCur').textContent = fmt(audio.currentTime); $('#tDur').textContent = fmt(d);
});
let seeking = false;
$('#prog').addEventListener('input', (e) => { seeking = true; setP(e.target, e.target.value / 10); });
$('#prog').addEventListener('change', (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; seeking = false; });
$('#vol').addEventListener('input', (e) => { S.set.vol = +e.target.value; audio.volume = S.set.vol / 100; setP(e.target, S.set.vol); save(); });

// ───────── 下载（只有点了下载按钮才会发生） ─────────
async function download(t) {
  if (downloading.has(t.id)) return;
  downloading.add(t.id); render();
  try {
    const r = await api.download(slim(t));
    if (r.gh) {
      t.gh = r.gh;
      const o = onlineById.get(t.id);
      if (o) o.gh = r.gh; else { S.online.push({ ...slim(t), gh: r.gh }); reindex(); }
      changed(); toast('已下载，并保存到 GitHub');
    } else toast(r.note || '已保存到本机');
  } catch (e) { toast('下载失败：' + e.message, 4000); }
  downloading.delete(t.id); render();
}

// ───────── GitHub 同步 ─────────
function syncBadge(state, tip) {
  const b = $('#bSync');
  b.className = 'cap ' + state; b.title = tip;
}
async function syncNow() {
  clearTimeout(syncTimer);
  if (!syncCfg.hasToken || syncing) return;
  syncing = true; syncBadge('busy', '正在同步…');
  const mark = dirty;
  try {
    const merged = await api.syncRun({ playlists: S.playlists, deleted: S.deleted, online: S.online, onlineDeleted: S.onlineDeleted, keywords: S.keywords, kwUpdatedAt: S.kwUpdatedAt });
    if (merged && mark === dirty) { // 同步期间本机没有新改动才采用合并结果
      Object.assign(S, { playlists: merged.playlists, deleted: merged.deleted, online: merged.online, onlineDeleted: merged.onlineDeleted, keywords: merged.keywords, kwUpdatedAt: merged.kwUpdatedAt });
      if (!fav()) S.playlists.unshift({ id: 'fav', name: '我喜欢', createdAt: 0, updatedAt: 0, tracks: [] });
      if (plOpen && plOpen[0] !== '@' && !pl(plOpen)) plOpen = null;
      reindex(); save(); render(); updateNow();
    } else if (mark !== dirty) syncTimer = setTimeout(syncNow, 4000);
    syncBadge('ok', '已同步 ' + new Date().toLocaleTimeString());
  } catch (e) { syncBadge('err', '同步失败：' + e.message); }
  syncing = false;
}

// ───────── 弹出层 ─────────
function showMenu(anchor, items) {
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-m="${i}">${esc(it.label)}</button>`)).join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(6, Math.min(r.right - w, innerWidth - w - 6)) + 'px';
  m.style.top = (r.bottom + h + 6 > innerHeight ? Math.max(6, r.top - h - 2) : r.bottom + 2) + 'px';
  m.onclick = (e) => { const b = e.target.closest('button'); if (b) { m.hidden = true; items[+b.dataset.m].run(); } };
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });

function ask(title, value, okText = '确定') {
  return new Promise((res) => {
    const d = $('#dialog');
    d.innerHTML = `<div class="box"><h4>${esc(title)}</h4>` + (value === null ? '' : `<input class="field" value="${esc(value)}" maxlength="40">`) +
      `<div class="line"><button class="btn pri" data-ok>${esc(okText)}</button><button class="btn" data-no>取消</button></div></div>`;
    d.hidden = false;
    const inp = d.querySelector('input');
    if (inp) { inp.focus(); inp.select(); }
    const done = (v) => { d.hidden = true; d.onclick = d.onkeydown = null; res(v); };
    d.onclick = (e) => {
      if (e.target.closest('[data-ok]')) done(inp ? inp.value.trim() : true);
      else if (e.target.closest('[data-no]') || e.target === d) done(null);
    };
    d.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp ? inp.value.trim() : true); if (e.key === 'Escape') done(null); };
  });
}

// ───────── 设置页 ─────────
function crawlApply() { api.crawlSet({ on: !!S.set.auto, keywords: S.keywords, sites: S.sites }).catch(() => {}); }
function sheetHtml(note = '') {
  const folders = S.folders.map((f, i) => `<div class="line"><span class="path" title="${esc(f)}">${esc(f)}</span><button class="act" data-s="rmf" data-i="${i}" title="移除">${IC.close}</button></div>`).join('');
  const kws = S.keywords.map((k, i) => `<button class="chip" data-s="rmk" data-i="${i}" title="点击移除">${esc(k)} ×</button>`).join('');
  const sites = S.sites.map((u, i) => `<div class="line"><span class="path" title="${esc(u)}">${esc(u)}</span><button class="act" data-s="rms" data-i="${i}" title="移除">${IC.close}</button></div>`).join('');
  return `<h2><button class="act" data-s="close" title="返回">${IC.back}</button>&nbsp;设置</h2>
  <h3>GitHub 同步</h3>
  <div class="card">
    <p>歌单、歌曲地址和下载的歌曲都保存在你的 GitHub 仓库里。每台电脑填一次访问令牌，之后自动同步，看到的内容完全一样。</p>
    <div class="line"><input class="field" id="sRepo" value="${esc((syncCfg.owner || '') + '/' + (syncCfg.repo || ''))}" placeholder="用户名/仓库名" spellcheck="false"></div>
    <div class="line"><input class="field" id="sToken" type="password" placeholder="${syncCfg.hasToken ? '令牌已保存（如需更换再填）' : '粘贴访问令牌'}" spellcheck="false"><button class="btn pri" data-s="saveSync">保存</button></div>
    <div class="line"><a data-s="newToken">去 GitHub 创建令牌</a><span class="grow"></span>${syncCfg.hasToken ? '<a data-s="syncNow">立即同步</a>&nbsp;&nbsp;<a data-s="logout">退出登录</a>' : ''}</div>
    <div class="note ${note.startsWith('!') ? 'bad' : 'ok'}" id="sNote">${esc(note.replace(/^!/, ''))}</div>
  </div>
  <h3>本地音乐文件夹</h3>
  <div class="card">${folders || '<p>还没有添加文件夹</p>'}
    <div class="line"><button class="btn" data-s="addf">添加文件夹</button><button class="btn" data-s="rescan">重新扫描</button></div>
  </div>
  <h3>持续搜索</h3>
  <div class="card">
    <p>后台爬虫会按下面的关键词在免费音乐库里逐层深入寻找，只记录能播放的地址，不会自动下载。没有关键词时按热门分类寻找。</p>
    <div class="tags">${kws}</div>
    <div class="line"><input class="field" id="sKw" placeholder="添加关键词，例如 钢琴、jazz" maxlength="40"><button class="btn" data-s="addk">添加</button></div>
  </div>
  <div class="card">
    <p>也可以添加提供免费音乐的网站，爬虫会抓取页面里的音频链接并沿站内链接向下两层。</p>
    ${sites}
    <div class="line"><input class="field" id="sSite" placeholder="https://…" spellcheck="false"><button class="btn" data-s="adds">添加</button></div>
  </div>
  <h3>其他</h3>
  <div class="card">
    <div class="line">显示 / 隐藏窗口<span class="grow"></span><b>${esc(info.hotkey || '')}</b></div>
    <div class="line">下载的歌曲<span class="grow"></span><a data-s="openDir">打开文件夹</a></div>
    <div class="line">版本<span class="grow"></span>${esc(info.version || '')}</div>
  </div>`;
}
function openSheet(note) { const s = $('#sheet'); s.innerHTML = sheetHtml(note); s.hidden = false; }
async function rescan() {
  $('#hint').textContent = '正在扫描…';
  try { S.local = await api.scan(S.folders); } catch (e) { toast('扫描失败：' + e.message); }
  reindex(); save(); render();
}
async function addFolder() {
  const f = await api.pickFolder();
  if (!f || S.folders.includes(f)) return;
  S.folders.push(f); await rescan();
}
$('#sheet').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  const a = b.dataset.s, i = +b.dataset.i;
  if (a === 'close') { $('#sheet').hidden = true; return; }
  if (a === 'rmf') { S.folders.splice(i, 1); await rescan(); }
  if (a === 'addf') await addFolder();
  if (a === 'rescan') { await rescan(); toast(`共 ${S.local.length} 首`); }
  if (a === 'rmk') { S.keywords.splice(i, 1); S.kwUpdatedAt = Date.now(); changed(); crawlApply(); }
  if (a === 'addk') { const v = $('#sKw').value.trim(); if (v && !S.keywords.includes(v)) { S.keywords.push(v); S.kwUpdatedAt = Date.now(); changed(); crawlApply(); } }
  if (a === 'rms') { S.sites.splice(i, 1); save(); crawlApply(); }
  if (a === 'adds') { const v = $('#sSite').value.trim(); if (/^https?:\/\/\S+\.\S+/.test(v) && !S.sites.includes(v)) { S.sites.push(v); save(); crawlApply(); } else if (v) return toast('请输入完整网址'); }
  if (a === 'openDir') return api.showMusicDir();
  if (a === 'newToken') return api.open('https://github.com/settings/personal-access-tokens/new');
  if (a === 'syncNow') { $('#sheet').hidden = true; return syncNow(); }
  if (a === 'logout') { await api.syncClear(); syncCfg = await api.syncGet(); syncBadge('', '未设置同步'); return openSheet('已退出，本机数据保留'); }
  if (a === 'saveSync') {
    const [owner, repo] = $('#sRepo').value.trim().split('/');
    const token = $('#sToken').value.trim();
    if (!owner || !repo) return openSheet('!仓库请写成 用户名/仓库名');
    if (!token && !syncCfg.hasToken) return openSheet('!请粘贴访问令牌');
    $('#sNote').className = 'note'; $('#sNote').textContent = '正在验证…';
    try {
      await api.syncSet({ owner, repo, token });
      syncCfg = await api.syncGet();
      openSheet('已连接，正在同步'); syncNow();
    } catch (err) { openSheet('!' + err.message); }
    return;
  }
  openSheet();
});

// ───────── 事件 ─────────
function switchTab(t) { tab = t; S.set.tab = t; limit = 300; if (t !== 'pl') plOpen = null; save(); render(); $('#list').scrollTop = 0; if (t === 'search') $('#q').focus(); }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
$('#sort').addEventListener('change', (e) => { S.set.sort = e.target.value; save(); render(); });
$('#q').addEventListener('input', (e) => { query = e.target.value; limit = 300; render(); });
async function webSearch() {
  const kw = query.trim(); if (!kw) return;
  if (!S.keywords.includes(kw)) { S.keywords.unshift(kw); S.keywords = S.keywords.slice(0, 30); S.kwUpdatedAt = Date.now(); changed(); crawlApply(); }
  toast(`正在网上搜索 “${kw}”，找到的歌会出现在这里`, 4000);
  try { await api.crawlBoost(kw); } catch (e) { toast('联网搜索失败：' + e.message, 4000); }
  render();
}
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') webSearch(); });
$('#bAuto').addEventListener('click', () => { S.set.auto = !S.set.auto; if (!S.set.auto) crawlText = ''; save(); crawlApply(); render(); });
$('#bAdd').addEventListener('click', addFolder);

$('#list').addEventListener('scroll', (e) => {
  const el = e.target;
  if (limit < view.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) { limit += 300; render(); }
});
$('#list').addEventListener('click', async (e) => {
  if (e.target.closest('[data-web]')) return webSearch();
  const tl = e.target.closest('[data-pl]');
  if (tl) {
    if (tl.dataset.pl === '+') return newPlaylist();
    plOpen = tl.dataset.pl; limit = 300; render(); $('#list').scrollTop = 0; return;
  }
  const row = e.target.closest('.row'); if (!row) return;
  const i = +row.dataset.i, t = view[i];
  const act = e.target.closest('[data-a]');
  if (!act) { queue = view.slice(); errStreak = 0; return playAt(i); }
  const a = act.dataset.a;
  if (a === 'fav') toggleFav(t);
  if (a === 'dl') download(t);
  if (a === 'rm') {
    if (tab === 'online') { removeOnline(t); render(); }
    else { const p = pl(plOpen); p.tracks = p.tracks.filter((x) => x.id !== t.id && Names.key(x) !== Names.key(t)); touch(p); render(); }
  }
  if (a === 'add') {
    showMenu(act, [
      ...S.playlists.map((p) => ({ label: p.name, run: () => addTo(p.id, t) })),
      '-', { label: '新建歌单…', run: () => newPlaylist(t) },
    ]);
  }
});
$('#pls').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-h]'); if (!b) return;
  const a = b.dataset.h, p = pl(plOpen);
  if (a === 'back') { plOpen = null; render(); }
  if (a === 'playall' && view.length) { queue = view.slice(); errStreak = 0; playAt(S.set.loop === 'shuffle' ? Math.floor(Math.random() * queue.length) : 0); }
  if (a === 'rename') { const n = await ask('重命名歌单', p.name); if (n) { p.name = n; touch(p); render(); } }
  if (a === 'del' && await ask(`删除歌单“${p.name}”？`, null, '删除')) {
    S.playlists = S.playlists.filter((x) => x.id !== p.id); S.deleted[p.id] = Date.now(); plOpen = null; changed(); render();
  }
});

$('#bPlay').addEventListener('click', toggle);
$('#bPrev').addEventListener('click', () => step(-1));
$('#bNext').addEventListener('click', () => step(1));
$('#bFav').addEventListener('click', () => cur && toggleFav(cur));
$('#bLoop').addEventListener('click', () => {
  const k = Object.keys(LOOPS); S.set.loop = k[(k.indexOf(S.set.loop) + 1) % k.length];
  save(); updateNow(); toast(LOOPS[S.set.loop], 1200);
});

function setMini(on) { document.body.classList.toggle('mini', on); api.mini(on); }
$('#bMini').addEventListener('click', () => setMini(true));
$('#bExpand').addEventListener('click', () => setMini(false));
$('#bMin').addEventListener('click', () => api.minimize());
$('#bClose').addEventListener('click', async () => {
  const toTray = await api.hide();
  if (toTray && !S.set.trayHint) { S.set.trayHint = true; save(); }
});
$('#bPin').addEventListener('click', () => { S.set.pin = !S.set.pin; S.win = { ...(S.win || {}), pin: S.set.pin }; api.pin(S.set.pin); $('#bPin').classList.toggle('on', S.set.pin); save(); });
$('#bSet').addEventListener('click', () => ($('#sheet').hidden ? openSheet() : ($('#sheet').hidden = true)));
$('#bSync').addEventListener('click', () => (syncCfg.hasToken ? syncNow() : openSheet('!填入访问令牌后即可在多台电脑间同步')));

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range';
  if (e.key === 'Escape') { $('#sheet').hidden = true; $('#menu').hidden = true; if (typing) document.activeElement.blur(); return; }
  if (typing || !$('#sheet').hidden) return;
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.ctrlKey && e.key === 'ArrowRight') step(1);
  else if (e.ctrlKey && e.key === 'ArrowLeft') step(-1);
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !document.body.classList.contains('mini')) {
    if (tab !== 'search') { query = ''; $('#q').value = ''; switchTab('search'); } else $('#q').focus(); // 直接打字即搜索
  }
});
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', toggle);
  navigator.mediaSession.setActionHandler('pause', toggle);
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
}
api.onCmd((m) => {
  if (m.type === 'toggle') toggle();
  else if (m.type === 'next') step(1);
  else if (m.type === 'prev') step(-1);
  else if (m.type === 'found') addOnline(m.tracks);
  else if (m.type === 'crawl') { crawlText = m.text; if (tab === 'online') { $('#hint').textContent = crawlText || `${view.length} 首可播放`; } }
});
window.addEventListener('beforeunload', () => { api.saveState(S); });

// ───────── 启动 ─────────
(async function init() {
  for (const [id, k] of [['icSearch', 'search'], ['bSync', 'sync'], ['bSet', 'set'], ['bPin', 'pin'], ['bMini', 'mini'], ['bMin', 'min'], ['bClose', 'close'], ['bPrev', 'prev'], ['bNext', 'next'], ['bExpand', 'up']]) $('#' + id).innerHTML = IC[k];
  const saved = await api.loadState().catch(() => null);
  const first = !saved;
  if (saved) S = { ...S, ...saved, set: { ...S.set, ...(saved.set || {}) } };
  if (!fav()) S.playlists.unshift({ id: 'fav', name: '我喜欢', createdAt: 0, updatedAt: 0, tracks: [] });
  info = await api.info().catch(() => ({}));
  if (info.accent && matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.style.setProperty('--accent', info.accent);
  syncCfg = await api.syncGet().catch(() => ({ hasToken: false }));
  syncBadge('', syncCfg.hasToken ? '点击同步' : '未设置同步');

  tab = S.set.tab === 'search' ? 'local' : S.set.tab || 'local';
  $('#sort').value = S.set.sort;
  $('#vol').value = S.set.vol; audio.volume = S.set.vol / 100; setP($('#vol'), S.set.vol);
  $('#bPin').classList.toggle('on', !!S.set.pin);
  reindex(); updateNow(); render();

  if (first) { try { S.folders = [await api.defaultFolder()]; } catch { /* 没有默认音乐文件夹 */ } }
  if (S.folders.length) await rescan(); // 每次启动重新核对本地文件，丢失的不再显示
  crawlApply();
  if (syncCfg.hasToken) setTimeout(syncNow, 1500);
  setInterval(syncNow, 3 * 60e3);
  setInterval(healthCheck, 25e3);
})();

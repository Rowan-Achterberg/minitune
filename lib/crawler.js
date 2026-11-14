// 后台爬虫：持续、逐层深入地在网上找免费音乐的“地址”。
// 只记录并验证地址，从不下载歌曲文件 —— 下载只在用户点下载按钮时发生。
//
// 来源：
//   1. Internet Archive（CC / 公共领域 / 乐队授权录音），由搜索结果 → 条目 → 同一作者的其他作品逐层展开
//   2. Wikimedia Commons（全部为自由版权音频）
//   3. 用户在设置里添加的网站：抓取页面里的音频链接，并沿站内链接向下爬（遵守 robots.txt）
const archive = require('./archive');

const DEFAULT_TOPICS = ['', 'classical', 'piano', 'jazz', 'instrumental', 'folk', 'chinese', 'rock', 'ambient', 'blues', 'electronic', 'guitar'];
const MAX_DEPTH = 2;
const PAGES_PER_SITE = 40;
const AUDIO_EXT = /\.(mp3|ogg|oga|m4a|flac|wav)(\?[^#]*)?$/i;
const UA = 'MiniTune/1.0 (personal music player)';

const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

class Crawler {
  constructor({ fetch, load, save, emit }) {
    this.fetch = fetch; this.load = load; this.save = save; this.emit = emit;
    this.cfg = { on: false, keywords: [], sites: [] };
    this.st = null; this.timer = null; this.busy = false; this.rr = 0; this.robots = {};
  }

  async init() {
    if (this.st) return;
    this.st = (await this.load()) || {};
    this.st.seen = this.st.seen || {};       // 已处理过的条目/页面
    this.st.frontier = this.st.frontier || []; // 待爬队列
    this.st.kwPage = this.st.kwPage || {};
    this.st.siteAt = this.st.siteAt || {};
  }

  async configure(cfg) {
    await this.init();
    this.cfg = { ...this.cfg, ...cfg };
    clearInterval(this.timer); this.timer = null;
    if (this.cfg.on) {
      this.timer = setInterval(() => this.tick(), 5000);
      setTimeout(() => this.tick(), 1500);
    } else this.emit({ type: 'crawl', text: '' });
  }

  // 用户主动搜索：插到队列最前面，马上执行
  async boost(kw) {
    await this.init();
    this.st.frontier.unshift(
      { type: 'ia-search', q: kw, page: 1, depth: 0, hot: true },
      { type: 'wm-search', q: kw, offset: 0, hot: true });
    for (let i = 0; i < 8 && this.st.frontier[0]?.hot; i++) await this.tick(true);
  }

  reseed() {
    const kws = this.cfg.keywords.length ? this.cfg.keywords : DEFAULT_TOPICS;
    const kw = kws[this.rr++ % kws.length];
    const page = (this.st.kwPage[kw] || 0) + 1;
    this.st.kwPage[kw] = page > 30 ? 0 : page;
    this.st.frontier.push({ type: 'ia-search', q: kw, page, depth: 0 });
    if (page <= 5) this.st.frontier.push({ type: 'wm-search', q: kw, offset: (page - 1) * 20 });
    const now = Date.now();
    for (const url of this.cfg.sites || []) {
      if (now - (this.st.siteAt[url] || 0) < 24 * 3600e3) continue;
      this.st.siteAt[url] = now;
      for (const k of Object.keys(this.st.seen)) if (k.startsWith('p:' + url + '|')) delete this.st.seen[k];
      this.st.frontier.push({ type: 'page', url, root: url, depth: 0 });
    }
  }

  async tick(force) {
    if (this.busy || (!this.cfg.on && !force)) return;
    this.busy = true;
    try {
      if (!this.st.frontier.length) this.reseed();
      const task = this.st.frontier.shift();
      if (task) await this.run(task);
      if (this.st.frontier.length > 4000) this.st.frontier.length = 4000;
      const keys = Object.keys(this.st.seen);
      if (keys.length > 30000) for (const k of keys.slice(0, 10000)) delete this.st.seen[k];
      await this.save(this.st);
    } catch (e) {
      this.emit({ type: 'crawl', text: '暂时连不上，稍后重试', error: String(e.message || e) });
    } finally { this.busy = false; }
  }

  add(task, key) {
    if (key) { if (this.st.seen[key]) return; this.st.seen[key] = 1; }
    if (task.hot) this.st.frontier.unshift(task); else this.st.frontier.push(task);
  }

  async found(tracks) { // 先验证能播放，再交给界面
    if (!tracks.length) return;
    const ok = await archive.verifyAll(this.fetch, tracks.map((t) => t.url));
    const good = tracks.filter((_, i) => ok[i]);
    if (good.length) this.emit({ type: 'found', tracks: good });
  }

  async run(t) {
    const label = t.q ? `“${t.q.replace(/^creator:/, '').replace(/"/g, '')}”` : '热门免费音乐';
    if (t.type === 'ia-search') {
      this.emit({ type: 'crawl', text: `正在搜索 ${label}`, queue: this.st.frontier.length });
      const docs = await archive.search(this.fetch, t.q, t.page, t.raw);
      for (const d of docs) this.add({ type: 'ia-item', id: d.id, depth: t.depth, hot: t.hot }, 'i:' + d.id);
    } else if (t.type === 'ia-item') {
      this.emit({ type: 'crawl', text: `正在检查 ${t.id}`, queue: this.st.frontier.length });
      const tracks = await archive.itemTracks(this.fetch, t.id);
      await this.found(tracks);
      const creator = tracks[0]?.artist;
      if (creator && t.depth < MAX_DEPTH) { // 向下一层：同一作者的其他作品
        this.add({ type: 'ia-search', q: `creator:"${creator.replace(/["\\]/g, ' ')}"`, raw: true, page: 1, depth: t.depth + 1 },
          'c:' + creator.toLowerCase());
      }
    } else if (t.type === 'wm-search') {
      this.emit({ type: 'crawl', text: `正在搜索 ${label}（Wikimedia）`, queue: this.st.frontier.length });
      await this.found(await this.commons(t.q, t.offset));
    } else if (t.type === 'page') {
      this.emit({ type: 'crawl', text: `正在爬取 ${t.url}`, queue: this.st.frontier.length });
      await this.page(t);
    }
  }

  async commons(q, offset) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search' +
      `&gsrsearch=${encodeURIComponent('filetype:audio filesize:>1000 ' + (q || 'music'))}&gsrnamespace=6&gsrlimit=20&gsroffset=${offset || 0}` +
      '&prop=imageinfo&iiprop=url|size|mime|extmetadata';
    const r = await this.fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const out = [];
    for (const p of Object.values(j.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/audio|ogg/.test(ii.mime || '')) continue;
      const id = 'wm:' + p.title;
      if (this.st.seen[id]) continue; this.st.seen[id] = 1;
      const em = ii.extmetadata || {};
      out.push({
        id, src: 'wm', url: ii.url,
        title: strip(em.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        artist: strip(em.Artist?.value).slice(0, 60), album: 'Wikimedia Commons',
        genre: strip(em.Categories?.value).slice(0, 80),
        no: 0, dur: 0, kbps: /mpeg/.test(ii.mime) ? 128 : 160,
      });
    }
    return out;
  }

  async allowed(u) { // robots.txt 里对所有爬虫禁止的路径不去碰
    if (!(u.origin in this.robots)) {
      const dis = [];
      try {
        const r = await this.fetch(u.origin + '/robots.txt', { headers: { 'User-Agent': UA } });
        if (r.ok) {
          let mine = false;
          for (const line of (await r.text()).split('\n')) {
            const m = /^\s*(user-agent|disallow)\s*:\s*(\S*)/i.exec(line);
            if (!m) continue;
            if (m[1].toLowerCase() === 'user-agent') mine = m[2] === '*';
            else if (mine && m[2]) dis.push(m[2]);
          }
        }
      } catch { /* 没有 robots.txt */ }
      this.robots[u.origin] = dis;
    }
    return !this.robots[u.origin].some((d) => u.pathname.startsWith(d));
  }

  async page(t) {
    let u;
    try { u = new URL(t.url); } catch { return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    if (!(await this.allowed(u))) return;
    const r = await this.fetch(u.href, { headers: { 'User-Agent': UA } });
    if (!r.ok || !/html/.test(r.headers.get('content-type') || '')) return;
    const html = (await r.text()).slice(0, 2e6);
    const tracks = []; let pages = 0;
    const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      let link;
      try { link = new URL(m[1], u); } catch { continue; }
      if (AUDIO_EXT.test(link.pathname)) {
        const id = 'web:' + link.href;
        if (this.st.seen[id] || tracks.length >= 40) continue; this.st.seen[id] = 1;
        const name = decodeURIComponent(link.pathname.split('/').pop()).replace(AUDIO_EXT, '').replace(/[_+]/g, ' ');
        const text = strip(m[2]);
        const base = text && text.length < 80 && !/^(download|下载|mp3|play|播放)$/i.test(text) ? text : name;
        const sp = /^(.+?)\s+-\s+(.+)$/.exec(base);
        tracks.push({ id, src: 'web', url: link.href, title: sp ? sp[2] : base, artist: sp ? sp[1] : '', album: u.hostname, no: 0, dur: 0, kbps: 0 });
      } else if (link.host === u.host && t.depth < MAX_DEPTH && pages < PAGES_PER_SITE / 2 &&
        !/\.(jpg|png|gif|css|js|pdf|zip|svg|ico)$/i.test(link.pathname)) {
        pages++;
        this.add({ type: 'page', url: link.href, root: t.root, depth: t.depth + 1 }, 'p:' + t.root + '|' + link.href);
      }
    }
    await this.found(tracks);
  }
}

module.exports = { Crawler };

// 在线免费音乐源：Internet Archive（archive.org）的公开音频库。
// 只检索明确以 CC / 公共领域授权、或来自 netlabels、etree（乐队授权的现场录音）合集的条目。
const BASE = 'https://archive.org';
const FREE = '(collection:(netlabels OR etree) OR licenseurl:(*creativecommons* OR *publicdomain*))';

function timeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function getJson(fetch, url) {
  const t = timeout(20000);
  try {
    const r = await fetch(url, { signal: t.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { t.done(); }
}

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

function seconds(v) {
  if (!v) return 0;
  const s = String(v);
  if (s.includes(':')) return s.split(':').reduce((a, x) => a * 60 + parseFloat(x || 0), 0);
  return parseFloat(s) || 0;
}

function kbpsOf(f, dur) {
  const b = parseFloat(f.bitrate);
  if (b > 0) return Math.round(b);
  const size = parseFloat(f.size);
  if (size > 0 && dur > 0) return Math.round((size * 8) / dur / 1000);
  const m = /(\d+)\s*kbps/i.exec(f.format || '');
  return m ? +m[1] : 160;
}

async function search(fetch, keyword, page = 1, raw = false) {
  const kw = raw ? String(keyword) : String(keyword || '').replace(/[()":\\]/g, ' ').trim();
  const q = `mediatype:audio AND format:MP3 AND ${FREE}` + (kw ? ` AND (${kw})` : '');
  const url = `${BASE}/advancedsearch.php?q=${encodeURIComponent(q)}` +
    '&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads+desc' +
    `&rows=20&page=${page}&output=json`;
  const j = await getJson(fetch, url);
  return (j.response?.docs || []).map((d) => ({ id: d.identifier, title: first(d.title), creator: first(d.creator) }));
}

// 取一个条目里的全部 MP3（尚未验证可播放）
async function itemTracks(fetch, identifier) {
  const j = await getJson(fetch, `${BASE}/metadata/${encodeURIComponent(identifier)}`);
  const md = j.metadata || {};
  const genre = [].concat(md.subject || []).join(' ').slice(0, 80);
  const year = parseInt(String(first(md.year) || first(md.date) || '').slice(0, 4), 10) || 0;
  const out = [];
  for (const f of j.files || []) {
    if (!/\.mp3$/i.test(f.name || '')) continue;
    const dur = seconds(f.length);
    if (dur && dur < 30) continue; // 试听片段、提示音
    const base = f.name.split('/').pop().replace(/\.mp3$/i, '');
    out.push({
      id: 'ia:' + identifier + '/' + f.name,
      src: 'ia',
      item: identifier,
      url: `${BASE}/download/${encodeURIComponent(identifier)}/` + f.name.split('/').map(encodeURIComponent).join('/'),
      title: String(f.title || base.replace(/^\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ')).trim(),
      artist: String(first(f.artist) || first(f.creator) || first(md.creator) || '').trim(),
      album: String(first(f.album) || first(md.title) || '').trim(),
      no: parseInt(f.track, 10) || 0,
      dur: Math.round(dur),
      kbps: kbpsOf(f, dur),
      genre: String(first(f.genre) || genre), year,
    });
    if (out.length >= 60) break;
  }
  return out;
}

// 真的去取开头几个字节，确认这个地址现在能播放
async function verify(fetch, url) {
  const t = timeout(12000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: t.signal });
    const type = (r.headers.get('content-type') || '').toLowerCase();
    const ok = (r.status === 200 || r.status === 206) && /audio|octet-stream|mpeg|ogg/.test(type);
    try { await r.body?.cancel(); } catch {}
    return ok;
  } catch { return false; } finally { t.done(); }
}

async function verifyAll(fetch, urls, concurrency = 4) {
  const res = new Array(urls.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) { const k = i++; res[k] = await verify(fetch, urls[k]); }
  }));
  return res;
}

module.exports = { search, itemTracks, verify, verifyAll, seconds, kbpsOf };

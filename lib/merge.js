// 本机数据与 GitHub 上数据的合并（多台电脑最终一致）
const Names = require('./names');

const MAX_ONLINE = 3000;
const MAX_TOMB = 6000;

function maxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!(k in out) || v > out[k]) out[k] = v;
  const keys = Object.keys(out);
  if (keys.length > MAX_TOMB) {
    keys.sort((x, y) => out[y] - out[x]);
    for (const k of keys.slice(MAX_TOMB)) delete out[k];
  }
  return out;
}

function merge(a = {}, b = {}) {
  const deleted = maxMap(a.deleted, b.deleted);
  const onlineDeleted = maxMap(a.onlineDeleted, b.onlineDeleted);

  // 歌单：同一歌单取最后修改的一份；被删除的不再出现
  const pls = new Map();
  for (const p of [...(a.playlists || []), ...(b.playlists || [])]) {
    const cur = pls.get(p.id);
    if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) pls.set(p.id, p);
  }
  const playlists = [...pls.values()]
    .filter((p) => p.id === 'fav' || !(deleted[p.id] >= (p.updatedAt || 0)))
    .sort((x, y) => (x.id === 'fav' ? -1 : y.id === 'fav' ? 1 : (x.createdAt || 0) - (y.createdAt || 0)));

  // 在线歌曲地址：并集，重名只留音质最好的
  const all = [...(a.online || []), ...(b.online || [])].filter((t) => !onlineDeleted[t.id]);
  const online = Names.dedupe(all).slice(0, MAX_ONLINE);

  const newer = (a.kwUpdatedAt || 0) >= (b.kwUpdatedAt || 0) ? a : b;
  return {
    version: 1,
    playlists, deleted, online, onlineDeleted,
    keywords: newer.keywords || [],
    kwUpdatedAt: newer.kwUpdatedAt || 0,
  };
}

// 与键顺序无关的比较串
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

module.exports = { merge, stable };

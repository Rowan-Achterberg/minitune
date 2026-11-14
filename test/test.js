const assert = require('assert');
const N = require('../lib/names');
const { merge, stable } = require('../lib/merge');
const archive = require('../lib/archive');
const { GitHub } = require('../lib/github');
const { Crawler } = require('../lib/crawler');

// 姓氏 / 排序
assert.equal(N.surname('欧阳菲菲'), '欧阳');
assert.equal(N.surname('周杰伦'), '周');
assert.equal(N.surname('Bob Dylan'), 'Dylan');
assert.equal(N.surname('Dylan, Bob'), 'Dylan');
const s = N.sortTracks([{ artist: '周杰伦', title: 'b' }, { artist: 'Bob Dylan', title: 'a' }, { artist: '邓丽君', title: 'c' }, { artist: 'Adele Adkins', title: 'd' }], 'surname');
assert.deepEqual(s.map((t) => t.artist), ['Adele Adkins', '邓丽君', 'Bob Dylan', '周杰伦']); // A, D(eng), D(ylan), Z(hou)
const al = N.sortTracks([{ album: 'B', no: 2, title: 'x' }, { album: 'B', no: 1, title: 'y' }, { album: 'A', no: 9, title: 'z' }], 'album');
assert.deepEqual(al.map((t) => t.title), ['z', 'y', 'x']);

// 重名只留最好的
const d = N.dedupe([{ id: 1, artist: 'A', title: 'Song', kbps: 64 }, { id: 2, artist: 'a', title: '01 - song', kbps: 320 }, { id: 3, artist: 'B', title: 'Song', kbps: 128 }]);
assert.deepEqual(d.map((t) => t.id), [2, 3]);
assert.equal(N.initials('周杰伦'), 'zjl');

// 合并：两台电脑
const A = { playlists: [{ id: 'fav', updatedAt: 5, tracks: [{ id: 'x' }] }, { id: 'p1', name: 'old', updatedAt: 1, tracks: [] }], online: [{ id: 'o1', artist: 'a', title: 't', kbps: 64 }], deleted: {}, onlineDeleted: {} };
const B = { playlists: [{ id: 'fav', updatedAt: 9, tracks: [{ id: 'y' }] }, { id: 'p2', name: 'two', createdAt: 3, updatedAt: 3, tracks: [] }], online: [{ id: 'o2', artist: 'a', title: 't', kbps: 320 }, { id: 'o3', artist: 'z', title: 'q', kbps: 128 }], deleted: { p1: 4 }, onlineDeleted: { o3: 1 } };
const m = merge(A, B);
assert.deepEqual(m.playlists.map((p) => p.id), ['fav', 'p2']);
assert.equal(m.playlists[0].tracks[0].id, 'y');
assert.deepEqual(m.online.map((t) => t.id), ['o2']);
assert.equal(stable(merge(A, B)), stable(merge(B, A)));           // 与顺序无关
assert.equal(stable(merge(m, m)), stable(m));                      // 幂等

assert.equal(archive.seconds('4:05'), 245);
assert.equal(archive.kbpsOf({ size: '8000000', format: 'VBR MP3' }, 200), 320);

// 用假的 fetch 走一遍 Archive 解析、验证和 GitHub 同步
const res = (status, body, type = 'application/json') => ({ ok: status < 300, status, headers: { get: () => type }, json: async () => body, text: async () => String(body), arrayBuffer: async () => Buffer.from(body), body: { cancel: async () => {} } });
(async () => {
  const iaFetch = async (url, opt) => {
    if (url.includes('advancedsearch')) return res(200, { response: { docs: [{ identifier: 'item1', title: 'T', creator: ['Band'] }] } });
    if (url.includes('/metadata/')) return res(200, { metadata: { title: 'Album', creator: 'Band', year: '1975', subject: ['rock'] }, files: [
      { name: '01 - Hello.mp3', format: 'VBR MP3', length: '200', size: '8000000', title: 'Hello', track: '1' },
      { name: 'Hello_64kb.mp3', format: '64Kbps MP3', length: '200', size: '1600000', title: 'Hello' },
      { name: 'dead.mp3', format: 'VBR MP3', length: '100', size: '2000000', title: 'Dead' },
      { name: 'cover.jpg' }] });
    if (url.includes('commons.wikimedia')) return res(200, {});
    if (url.includes('dead')) return res(404, '', 'text/html');
    return res(206, 'xx', 'audio/mpeg');
  };
  const found = [];
  let saved = null;
  const c = new Crawler({ fetch: iaFetch, load: async () => null, save: async (st) => { saved = st; }, emit: (m) => m.type === 'found' && found.push(...m.tracks) });
  await c.boost('hello');
  assert.deepEqual(found.map((t) => t.title).sort(), ['Hello', 'Hello']);   // 失效地址被验证剔除
  assert.equal(N.dedupe(found).length, 1);
  assert.equal(N.dedupe(found)[0].kbps, 320);                               // 留下高音质的
  assert.ok(saved.frontier.some((t) => t.q === 'creator:"Band"'));          // 向下一层展开
  assert.ok(found[0].url.endsWith('/item1/01%20-%20Hello.mp3'));

  // GitHub：内存里的假仓库
  const repo = { files: {}, n: 0 };
  const ghFetch = async (url, opt = {}) => {
    const m = /contents\/([^?]+)/.exec(url);
    if (!m) return res(200, { default_branch: 'main', permissions: { push: true } });
    const p = decodeURIComponent(m[1]);
    if ((opt.method || 'GET') === 'GET') {
      const f = repo.files[p]; if (!f) return res(404, {});
      return res(200, { sha: f.sha, encoding: 'base64', content: f.content });
    }
    const b = JSON.parse(opt.body), f = repo.files[p];
    if (f && b.sha !== f.sha) return res(f && !b.sha ? 422 : 409, {});
    repo.files[p] = { sha: 's' + ++repo.n, content: b.content };
    return res(f ? 200 : 201, {});
  };
  const cfg = { owner: 'o', repo: 'r', branch: 'userdata', token: 't' };
  const pc1 = new GitHub(cfg, ghFetch), pc2 = new GitHub(cfg, ghFetch);
  const r1 = await pc1.sync(A);
  const r2 = await pc2.sync(B);
  const r1b = await pc1.sync(r1);
  assert.equal(stable(r2), stable(r1b));                                    // 两台电脑内容一致
  const before = repo.n; await pc1.sync(r1b); assert.equal(before, repo.n); // 无变化不重复提交
  assert.equal(await pc1.uploadSong('music/歌 a.mp3', Buffer.from('x')), true);
  assert.equal(await pc2.uploadSong('music/歌 a.mp3', Buffer.from('x')), true);
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

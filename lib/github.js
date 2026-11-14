// GitHub 同步：歌单/地址存为 library.json，下载的歌曲存到 music/，都在数据分支上。
const { merge, stable } = require('./merge');

class GitHub {
  constructor(cfg, fetch) {
    this.cfg = cfg; // { owner, repo, branch, token }
    this.fetch = fetch;
    this.chain = Promise.resolve(); // 写操作排队，避免同一分支并发提交冲突
  }

  get ready() { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); }
  base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  enc(p) { return p.split('/').map(encodeURIComponent).join('/'); }

  async req(method, url, { body, accept } = {}) {
    const r = await this.fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + this.cfg.token,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MiniTune',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r;
  }

  async test() {
    const r = await this.req('GET', this.base());
    if (r.status === 401) throw new Error('令牌无效或已过期');
    if (r.status === 404) throw new Error('找不到仓库，或令牌没有该仓库的权限');
    if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
    const j = await r.json();
    if (j.permissions && !j.permissions.push) throw new Error('令牌对该仓库没有写入权限');
    return true;
  }

  async ensureBranch() {
    const b = this.cfg.branch;
    let r = await this.req('GET', `${this.base()}/git/ref/heads/${this.enc(b)}`);
    if (r.ok) return;
    r = await this.req('GET', this.base());
    if (!r.ok) throw new Error('无法读取仓库 ' + r.status);
    const def = (await r.json()).default_branch;
    r = await this.req('GET', `${this.base()}/git/ref/heads/${this.enc(def)}`);
    if (!r.ok) throw new Error('仓库还是空的，请先推送一次代码');
    const sha = (await r.json()).object.sha;
    r = await this.req('POST', `${this.base()}/git/refs`, { body: { ref: 'refs/heads/' + b, sha } });
    if (!r.ok && r.status !== 422) throw new Error('无法创建数据分支 ' + r.status);
  }

  // → { sha, buf } 或 null（文件不存在）
  async getFile(path) {
    const r = await this.req('GET', `${this.base()}/contents/${this.enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('读取失败 ' + r.status);
    const j = await r.json();
    if (j.content && j.encoding === 'base64') return { sha: j.sha, buf: Buffer.from(j.content, 'base64') };
    const b = await this.req('GET', `${this.base()}/git/blobs/${j.sha}`); // 超过 1MB 的文件
    if (!b.ok) throw new Error('读取失败 ' + b.status);
    return { sha: j.sha, buf: Buffer.from((await b.json()).content, 'base64') };
  }

  async getRaw(path) {
    const r = await this.req('GET', `${this.base()}/contents/${this.enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
      { accept: 'application/vnd.github.raw' });
    if (!r.ok) throw new Error('下载失败 ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }

  // 返回 HTTP 状态码；409/422 表示版本冲突或文件已存在
  async putOnce(path, buf, message, sha) {
    const r = await this.req('PUT', `${this.base()}/contents/${this.enc(path)}`, {
      body: { message, content: buf.toString('base64'), branch: this.cfg.branch, ...(sha ? { sha } : {}) },
    });
    return r.status;
  }

  queue(fn) {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  // 上传一首歌；已存在视为成功
  uploadSong(path, buf) {
    return this.queue(async () => {
      for (let i = 0; i < 3; i++) {
        let s = await this.putOnce(path, buf, '下载歌曲 ' + path.split('/').pop());
        if (s === 404) { await this.ensureBranch(); s = await this.putOnce(path, buf, '下载歌曲 ' + path.split('/').pop()); }
        if (s === 200 || s === 201) return true;
        if (s === 422) return true; // 同名文件已在仓库里
        if (s !== 409) throw new Error('上传失败 ' + s);
      }
      throw new Error('上传失败（多次冲突）');
    });
  }

  // 拉取 → 合并 → 有变化才推送；返回合并后的数据
  sync(local) {
    return this.queue(async () => {
      for (let i = 0; i < 4; i++) {
        const f = await this.getFile('library.json');
        let remote = {};
        if (f) { try { remote = JSON.parse(f.buf.toString('utf8')); } catch { remote = {}; } }
        const merged = merge(local, remote);
        if (f && stable(merged) === stable(remote)) return merged;
        const buf = Buffer.from(JSON.stringify(merged));
        let s = await this.putOnce('library.json', buf, '同步歌单', f?.sha);
        if (s === 404) { await this.ensureBranch(); s = await this.putOnce('library.json', buf, '同步歌单', f?.sha); }
        if (s === 200 || s === 201) return merged;
        if (s !== 409 && s !== 422) throw new Error('同步失败 ' + s);
      }
      throw new Error('同步失败（多次冲突）');
    });
  }
}

module.exports = { GitHub };

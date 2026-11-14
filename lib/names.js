// 姓氏/姓名排序、重名去重、音质比较。浏览器与 Node 共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Names = factory();
})(this, function () {
  const COMPOUND = ['欧阳', '歐陽', '司马', '司馬', '上官', '诸葛', '諸葛', '东方', '東方', '皇甫', '尉迟', '尉遲',
    '公孙', '公孫', '慕容', '令狐', '司徒', '夏侯', '端木', '轩辕', '軒轅', '长孙', '長孫', '宇文', '南宫', '南宮',
    '独孤', '獨孤', '澹台', '公冶', '太史', '申屠', '呼延', '钟离', '鍾離'];
  const CJK = /^[㐀-鿿]/;
  const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
  // 中英文混排：先按（拼音）首字母 A–Z，再按拼音/字母细排
  const bucket = (x) => { const c = initials([...String(x || '')][0] || '')[0]; return c && c >= 'a' && c <= 'z' ? c : c ? '0' : '~'; };
  const cmp = (a, b) => {
    const ba = bucket(a), bb = bucket(b);
    return ba < bb ? -1 : ba > bb ? 1 : collator.compare(a || '', b || '');
  };

  // 多位歌手只取第一位
  function firstArtist(artist) {
    let a = String(artist || '').trim();
    const m = a.match(/^([^,\s]+),\s*([^,]+)$/); // "Dylan, Bob"
    if (m) return m[2].trim() + ' ' + m[1].trim();
    return a.split(/\s*(?:[,;&/、]|\bfeat\.?\s|\bft\.?\s|\band\b)\s*/i)[0].trim();
  }

  function surname(artist) {
    const a = firstArtist(artist);
    if (!a) return '#';
    if (CJK.test(a)) {
      const c = COMPOUND.find((x) => a.startsWith(x));
      return c || a[0];
    }
    const words = a.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean);
    const w = words[words.length - 1] || a;
    return w[0].toUpperCase() + w.slice(1);
  }

  function norm(s) {
    return String(s || '').normalize('NFKC').toLowerCase()
      .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '') // 开头的曲目序号
      .replace(/[\s\-_.,'"!?·:;()[\]{}《》「」，。！？、]+/g, '');
  }
  // 重名判断：歌手 + 歌名
  const key = (t) => norm(firstArtist(t.artist)) + '|' + norm(t.title);

  // a 是否比 b 更好：码率高者优先；相同则已下载到 GitHub 的优先
  function better(a, b) {
    const ka = a.kbps || 0, kb = b.kbps || 0;
    if (Math.abs(ka - kb) > Math.max(ka, kb) * 0.05) return ka > kb;
    return !!a.gh && !b.gh;
  }

  // 重名只保留最好的一首，保持首次出现的顺序
  function dedupe(list) {
    const map = new Map();
    for (const t of list) {
      const k = key(t);
      const cur = map.get(k);
      if (!cur || better(t, cur)) map.set(k, t);
    }
    return [...map.values()];
  }

  // 汉字 → 拼音首字母（用拼音排序的分界字推算），用于“敲第一个字母就出结果”
  const PY_L = 'abcdefghjklmnopqrstwxyz', PY_B = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥扨它穵夕丫帀';
  const zh = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
  const pyCache = new Map();
  function initials(s) {
    let out = '';
    for (const ch of String(s || '').toLowerCase()) {
      if (/[\u4e00-\u9fff]/.test(ch)) {
        let c = pyCache.get(ch);
        if (!c) {
          c = ch;
          for (let i = PY_B.length - 1; i >= 0; i--) if (zh.compare(ch, PY_B[i]) >= 0) { c = PY_L[i]; break; }
          pyCache.set(ch, c);
        }
        out += c;
      } else if (/[a-z0-9]/.test(ch)) out += ch;
    }
    return out;
  }

  // 自动分类
  const HAN = /[\u3400-\u9fff]/;
  const INSTR = /纯音乐|純音樂|伴奏|轻音乐|輕音樂|钢琴曲|instrumental|karaoke|piano|guitar solo|symphon|sonata|concerto|orchestr|quartet|prelude|nocturne|étude|etude|fugue|ambient|soundtrack|\bost\b|\bbgm\b|no vocals?/i;
  const CLASSIC = /经典|經典|古典|怀旧|懷舊|老歌|classic|oldies|golden|bach|mozart|beethoven|chopin|tchaikovsky|vivaldi|schubert|debussy|brahms|handel|haydn|liszt|symphon|sonata|concerto|\bop\.? ?\d/i;
  function categories(t) {
    const text = [t.title, t.artist, t.album, t.genre].join(' ');
    const out = [];
    if (HAN.test((t.title || '') + (t.artist || ''))) out.push('zh');
    else if (/[a-z]/i.test(t.title || '')) out.push('en');
    out.push(INSTR.test(text) ? 'instr' : 'song');
    if (CLASSIC.test(text) || (t.year > 1000 && t.year < 1990)) out.push('classic');
    return out;
  }

  const UNKNOWN = '未知歌手';
  function groupOf(t, mode) {
    if (mode === 'surname') return surname(t.artist);
    if (mode === 'name') return t.artist || UNKNOWN;
    if (mode === 'album') return t.album || '未知专辑';
    return '';
  }

  function sortTracks(list, mode) {
    const byTitle = (a, b) => cmp(a.title, b.title);
    const byAlbum = (a, b) => cmp(a.album, b.album) || (a.no || 0) - (b.no || 0) || byTitle(a, b);
    const byName = (a, b) => cmp(a.artist, b.artist) || byAlbum(a, b);
    const f = {
      surname: (a, b) => cmp(surname(a.artist), surname(b.artist)) || byName(a, b),
      name: byName,
      album: (a, b) => byAlbum(a, b) || cmp(a.artist, b.artist),
      title: (a, b) => byTitle(a, b) || cmp(a.artist, b.artist),
    }[mode] || byTitle;
    return list.slice().sort(f);
  }

  return { surname, firstArtist, norm, key, better, dedupe, groupOf, sortTracks, cmp, initials, categories };
});

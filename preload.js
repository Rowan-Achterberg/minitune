const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => async (...args) => {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  loadState: call('state:load'), saveState: call('state:save'),
  hide: call('win:hide'), minimize: call('win:minimize'), pin: call('win:pin'), mini: call('win:mini'),
  info: call('sys:info'), open: call('sys:open'), showMusicDir: call('sys:showMusicDir'),
  defaultFolder: call('local:defaultFolder'), pickFolder: call('local:pick'), scan: call('local:scan'),
  crawlSet: call('crawl:set'), crawlBoost: call('crawl:boost'), verify: call('online:verify'),
  resolve: call('media:resolve'), download: call('media:download'),
  syncGet: call('sync:get'), syncSet: call('sync:set'), syncClear: call('sync:clear'), syncRun: call('sync:run'),
  onCmd: (fn) => ipcRenderer.on('cmd', (_e, c) => fn(c)),
});

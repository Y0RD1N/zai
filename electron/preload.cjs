const { contextBridge, ipcRenderer } = require('electron')
const subscribe = (channel, listener) => {
  const handler = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
contextBridge.exposeInMainWorld('zai', {
  load: () => ipcRenderer.invoke('workspace:load'),
  save: (data) => ipcRenderer.invoke('workspace:save', data),
  chooseFolder: () => ipcRenderer.invoke('project:choose'),
  revealFolder: (cwd) => ipcRenderer.invoke('project:reveal', cwd),
  info: () => ipcRenderer.invoke('app:info'),
  providers: () => ipcRenderer.invoke('app:providers'),
  external: (url) => ipcRenderer.invoke('app:external', url),
  window: (action) => ipcRenderer.invoke('app:window', action),
  finishClose: () => ipcRenderer.invoke('app:finish-close'),
  onClosing: (listener) => subscribe('app:closing', listener),
  send: (request) => ipcRenderer.invoke('agent:send', request),
  stop: (id) => ipcRenderer.invoke('agent:stop', id),
  closeAgent: (id) => ipcRenderer.invoke('agent:close', id),
  respond: (id, requestId, response) => ipcRenderer.invoke('agent:respond', id, requestId, response),
  onAgent: (listener) => subscribe('agent:event', listener),
  startTerminal: (request) => ipcRenderer.invoke('terminal:start', request),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),
  onTerminalData: (listener) => subscribe('terminal:data', listener),
  onTerminalExit: (listener) => subscribe('terminal:exit', listener),
})

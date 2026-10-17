const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { createAgentManager, findExecutable, launch } = require('./agents.cjs')
const { createProviderCatalog } = require('./providers.cjs')
const { resolveSelection } = require('./provider-data.cjs')

if (process.env.ZAI_USER_DATA) app.setPath('userData', process.env.ZAI_USER_DATA)
app.setName('Zai')
app.setAppUserModelId('io.github.y0rd1n.zai')
let window
let quitting = false
let quitRequested = false
let closeConfirmed = false
let rendererReady = false
let saving = Promise.resolve()
const terminals = new Map()
const terminalStarts = new Map()
const cancelledTerminals = new Set()
const emit = (channel, payload) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}
const catalogs = createProviderCatalog((event) => emit('provider:update', event))
const agents = createAgentManager((event) => {
  if (event.type === 'usage') catalogs.updateUsage(event.provider, event.usage)
  else emit('agent:event', event)
})
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)
const allowedUrl = (url) => {
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}
const trusted = (event) => window && event.sender === window.webContents && !event.senderFrame?.parent
const handle = (name, callback) => ipcMain.handle(name, (event, ...args) => {
  if (!trusted(event)) throw new Error('Origen no autorizado')
  return callback(...args)
})
async function directory(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Vincula una carpeta al proyecto primero.')
  if (!(await fs.stat(cwd)).isDirectory()) throw new Error('La carpeta del proyecto ya no está disponible.')
  return cwd
}

handle('workspace:load', async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'workspace.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('No se pudo leer la pizarra guardada.') }
})
handle('workspace:save', (data) => {
  if (!data || data.version !== 1 || !Array.isArray(data.projects)) throw new Error('Pizarra inválida')
  const json = JSON.stringify(data)
  if (json.length > 12_000_000) throw new Error('La pizarra supera el límite de almacenamiento.')
  const dest = path.join(app.getPath('userData'), 'workspace.json')
  const task = saving.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest + '.tmp', json, { mode: 0o600 })
    await fs.rename(dest + '.tmp', dest)
  })
  saving = task
  return task
})
handle('project:choose', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Vincular carpeta del proyecto', properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
handle('project:reveal', async (cwd) => shell.openPath(await directory(cwd)))
handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), home: os.homedir() }))
handle('provider:catalog', (provider, refresh) => {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Proveedor inválido')
  return catalogs.get(provider, refresh === true)
})
handle('app:providers', async () => {
  const probe = async (name) => {
    const executable = findExecutable(name)
    if (!executable) return { installed: false }
    return new Promise((resolve) => {
      const child = launch(executable, ['--version'], os.homedir())
      let output = ''
      const timer = setTimeout(() => { child.kill(); resolve({ installed: false }) }, 8000)
      child.stdout.on('data', (data) => { output = (output + data).slice(0, 4000) })
      child.stderr.resume()
      child.on('error', () => { clearTimeout(timer); resolve({ installed: false }) })
      child.on('exit', (code) => { clearTimeout(timer); resolve({ installed: code === 0, version: output.trim().split('\n')[0], path: executable }) })
    })
  }
  const [codex, claude] = await Promise.all([probe('codex'), probe('claude')])
  return { codex, claude }
})
handle('app:external', (url) => { if (!allowedUrl(url)) throw new Error('URL no permitida'); return shell.openExternal(url) })
handle('app:window', (action) => {
  if (action === 'minimize') window.minimize()
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  if (action === 'close') window.close()
})
handle('app:finish-close', async () => {
  await saving
  closeConfirmed = true
  if (quitRequested) shutdown()
  else window.close()
})
handle('agent:send', async (request) => {
  if (!request || !validId(request.id) || !['codex', 'claude'].includes(request.provider) ||
      typeof request.text !== 'string' || !request.text.trim() || request.text.length > 200_000) throw new Error('Mensaje inválido')
  for (const key of ['model', 'effort', 'speed']) if (request[key] !== undefined && (typeof request[key] !== 'string' || request[key].length > 200)) throw new Error('Configuración del agente inválida')
  await directory(request.cwd)
  const catalog = await catalogs.get(request.provider)
  return agents.send({ ...request, ...resolveSelection(catalog, request) })
})
handle('agent:stop', (id) => { if (validId(id)) return agents.stop(id) })
handle('agent:close', (id) => { if (validId(id)) agents.close(id) })
handle('agent:respond', (id, requestId, response) => {
  if (!validId(id) || typeof requestId !== 'string') throw new Error('Respuesta inválida')
  return agents.respond(id, requestId, response)
})
handle('terminal:start', async ({ id, cwd, cols = 80, rows = 24 }) => {
  if (!validId(id)) throw new Error('Terminal inválida')
  if (terminals.has(id)) return { buffer: terminals.get(id).buffer }
  if (terminalStarts.has(id)) return terminalStarts.get(id)
  const start = (async () => {
  await directory(cwd)
  if (cancelledTerminals.has(id)) throw new Error('Terminal cancelada')
  const pty = require('node-pty')
  const executable = process.platform === 'win32' ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/bash'
  const term = pty.spawn(executable, process.platform === 'win32' ? [] : ['-l'], {
    name: 'xterm-256color', cols: Math.max(10, Math.min(400, cols)), rows: Math.max(4, Math.min(200, rows)),
    cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  })
  const entry = { pty: term, buffer: '' }
  terminals.set(id, entry)
  term.onData((data) => { entry.buffer = (entry.buffer + data).slice(-120_000); emit('terminal:data', { id, data }) })
  term.onExit(({ exitCode }) => { terminals.delete(id); emit('terminal:exit', { id, exitCode }) })
  return { buffer: '' }
  })()
  terminalStarts.set(id, start)
  try { return await start } finally { terminalStarts.delete(id); cancelledTerminals.delete(id) }
})
handle('terminal:write', (id, data) => { if (typeof data === 'string' && data.length < 100_000) terminals.get(id)?.pty.write(data) })
handle('terminal:resize', (id, cols, rows) => {
  if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 10 && cols <= 400 && rows >= 4 && rows <= 200) terminals.get(id)?.pty.resize(cols, rows)
})
handle('terminal:close', (id) => { if (terminalStarts.has(id)) cancelledTerminals.add(id); terminals.get(id)?.pty.kill(); terminals.delete(id) })

function secureGuest(contents) {
  contents.on('will-navigate', (event, url) => { if (!allowedUrl(url)) event.preventDefault() })
  contents.setWindowOpenHandler(({ url }) => {
    if (!allowedUrl(url)) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: {
      parent: window, width: 960, height: 760, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, preload: undefined },
    } }
  })
  contents.on('did-create-window', (child) => secureGuest(child.webContents))
}
app.on('session-created', (ses) => {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
})

async function createWindow() {
  closeConfirmed = false
  rendererReady = false
  window = new BrowserWindow({
    width: 1600, height: 1030, minWidth: 920, minHeight: 650, title: 'Zai',
    backgroundColor: '#101113', autoHideMenuBar: true, frame: false, titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: true },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Zai', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ver', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ]))
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!allowedUrl(params.src) || !/^persist:zai-[a-zA-Z0-9_-]+$/.test(params.partition || '')) { event.preventDefault(); return }
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.webSecurity = true
    preferences.allowRunningInsecureContent = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => secureGuest(contents))
  window.webContents.on('did-finish-load', () => { rendererReady = true })
  window.webContents.on('render-process-gone', () => { rendererReady = false })
  window.on('close', (event) => {
    if (quitting || closeConfirmed || !rendererReady) return
    event.preventDefault()
    emit('app:closing')
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const devUrl = process.env.ZAI_DEV_URL
  if (devUrl === 'http://127.0.0.1:4317') await window.loadURL(devUrl)
  else await window.loadFile(path.join(__dirname, '../dist/index.html'))
  if (process.env.ZAI_TEST) window.webContents.on('console-message', (_event, details) => console.log('renderer:', details.message))
}
app.whenReady().then(createWindow)
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
app.on('window-all-closed', () => app.quit())
function shutdown() {
  if (quitting) return
  quitting = true
  agents.dispose()
  catalogs.dispose()
  for (const terminal of terminals.values()) terminal.pty.kill()
  saving.catch(() => {}).finally(() => app.quit())
}
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitRequested = true
  if (window && !window.isDestroyed() && rendererReady && !closeConfirmed) window.close()
  else shutdown()
})

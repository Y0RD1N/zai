const { app, BrowserWindow, ipcMain, dialog, shell, Menu, webContents, session, safeStorage, nativeImage, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const { createAgentManager, findExecutable, launch } = require('./agents.cjs')
const { createProviderCatalog } = require('./providers.cjs')
const { resolveSelection } = require('./provider-data.cjs')
const { permissions } = require('./permissions.cjs')
const { createBrowserHub } = require('./browser-hub.cjs')
const { createAPIProfiles } = require('./api-profiles.cjs')
const { apiCatalog } = require('./api-catalog.cjs')
const { createZaiRuntime } = require('./zai-runtime.cjs')
const { createBackgrounds } = require('./backgrounds.cjs')
const { createBrowserController } = require('./browser-controller.cjs')

if (process.env.ZAI_USER_DATA) app.setPath('userData', process.env.ZAI_USER_DATA)
protocol.registerSchemesAsPrivileged([{ scheme: 'zai-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.setName('Zai')
app.setAppUserModelId('io.github.y0rd1n.zai')
// Chromium enables hardware acceleration automatically when the driver supports it.
// Keep its compatibility checks; never force a blocked or unstable driver.
const graphicsFile = path.join(app.getPath('userData'), 'graphics.json')
let graphicsMode = 'auto'
try { if (JSON.parse(fsSync.readFileSync(graphicsFile, 'utf8')).mode === 'off') graphicsMode = 'off' } catch { /* default: automatic GPU */ }
const initialGraphicsMode = graphicsMode
if (graphicsMode === 'off') app.disableHardwareAcceleration()
let graphicsSaving = Promise.resolve()
async function graphicsInfo() {
  let info = {}, reason
  try { info = await app.getGPUInfo('basic') } catch { reason = 'El motor gráfico no pudo usar la GPU. Se mantiene el renderizado por software del sistema.' }
  const features = app.getGPUFeatureStatus()
  const device = info.gpuDevice?.find((v) => v.active) || info.gpuDevice?.[0]
  const vendor = ({ 4098: 'AMD', 4318: 'NVIDIA', 32902: 'Intel', 4203: 'Apple', 20803: 'Qualcomm' })[device?.vendorId] || 'GPU del sistema'
  const renderer = info.auxAttributes?.glRenderer || device?.deviceString || device?.vendorString || vendor
  return { mode: graphicsMode, enabled: app.isHardwareAccelerationEnabled(), hardware: Boolean(!reason && features.gpu_compositing?.startsWith('enabled') && info.auxAttributes?.softwareRendering !== true && !/swiftshader|llvmpipe|software/i.test(renderer)), renderer, reason, features, requiresRestart: graphicsMode !== initialGraphicsMode }
}
let window
let quitting = false
let quitRequested = false
let closeConfirmed = false
let rendererReady = false
let saving = Promise.resolve()
const terminals = new Map()
const terminalStarts = new Map()
const cancelledTerminals = new Set()
const agentStarts = new Set()
const cancelledAgents = new Set()
const emit = (channel, payload) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}
const catalogs = createProviderCatalog((event) => emit('provider:update', event))
const browserController = createBrowserController({ webContents, session, host: () => window?.webContents,
  hasBrowser: (id, projectId) => browserHub.hasBrowser(id, projectId),
  isBrowserVisible: (id) => browserHub.isBrowserVisible(id) && !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized(),
  navigate: (event) => emit('browser:navigate', event) })
const browserHub = createBrowserHub({ perform: (...args) => browserController.perform(...args), describe: (id) => browserController.describe(id),
  emit: (event) => emit('browser:activity', event), agentEvent: (event) => emit('agent:event', event) })
const agents = createAgentManager((event) => {
  if ((event.type === 'status' && ['idle', 'stopped'].includes(event.status)) || event.type === 'error') browserHub.setActive(event.id, false)
  if (event.type === 'usage') catalogs.updateUsage(event.provider, event.usage)
  else emit('agent:event', event)
})
const apiProfiles = createAPIProfiles({ directory: app.getPath('userData'), safeStorage })
const backgrounds = createBackgrounds({ directory: path.join(app.getPath('userData'), 'backgrounds'), nativeImage, profiles: apiProfiles })
const zaiRuntime = createZaiRuntime({ directory: path.join(app.getPath('userData'), 'agent-sessions'), profiles: apiProfiles, browserHub, emit: (event) => {
  if (event.type === 'error' || event.type === 'status' && ['idle', 'stopped'].includes(event.status)) browserHub.setActive(event.id, false)
  emit('agent:event', event)
} })
const apiCatalogCache = new Map()
async function connectionCatalog(id, refresh = false, model) {
  const key = `${id}:${model || ''}`
  const cached = apiCatalogCache.get(key)
  if (!refresh && cached && Date.now() - cached.updatedAt < 60_000) return cached
  const p = await apiProfiles.get(id)
  const result = await apiCatalog({ ...p, model: model || p.model }); apiCatalogCache.set(key, result); return result
}
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
handle('graphics:info', () => graphicsInfo())
handle('graphics:mode', (mode) => {
  if (!['auto', 'off'].includes(mode)) throw new Error('Opción de gráficos inválida.')
  const task = graphicsSaving.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(graphicsFile), { recursive: true }); await fs.writeFile(graphicsFile + '.tmp', JSON.stringify({ mode }), { mode: 0o600 }); await fs.rename(graphicsFile + '.tmp', graphicsFile); graphicsMode = mode; return graphicsInfo() })
  graphicsSaving = task; return task
})
handle('api:profiles', () => apiProfiles.list())
handle('api:save', async (value) => { const result = await apiProfiles.save(value); apiCatalogCache.clear(); return result })
handle('api:delete', async (id) => { if (!validId(id)) throw new Error('Conexión inválida.'); await apiProfiles.delete(id); apiCatalogCache.clear() })
handle('api:catalog', (id, model) => { if (!validId(id) || model !== undefined && (typeof model !== 'string' || model.length > 200)) throw new Error('Conexión inválida.'); return connectionCatalog(id, false, model) })
handle('background:import', async () => { const result = await dialog.showOpenDialog(window, { title: 'Elegir fondo de la pizarra', properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] }); return result.canceled ? null : backgrounds.import(result.filePaths[0]) })
handle('background:generate', (value) => backgrounds.generate(value))
handle('background:cancel', () => backgrounds.cancel())
handle('browser:disconnect', (agentId, browserId) => { if (!validId(agentId) || !validId(browserId)) throw new Error('Conexión inválida.'); return browserHub.disconnect(agentId, browserId) })
handle('browser:sync', (projects) => browserHub.sync(projects))
handle('browser:register', (data) => {
  if (!data || !validId(data.id) || !validId(data.projectId) || !Number.isInteger(data.guestId)) throw new Error('Navegador inválido.')
  browserController.register(data)
})
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
  return { codex, claude, zai: { installed: true, version: 'Motor integrado · API y local' } }
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
  if (!request || !validId(request.id) || !['codex', 'claude', 'zai'].includes(request.provider) ||
      typeof request.text !== 'string' || !request.text.trim() || request.text.length > 200_000) throw new Error('Mensaje inválido')
  for (const key of ['model', 'effort', 'speed']) if (request[key] !== undefined && (typeof request[key] !== 'string' || request[key].length > 200)) throw new Error('Configuración del agente inválida')
  if (agentStarts.has(request.id) || agents.active(request.id) || zaiRuntime.active(request.id)) throw new Error('Este agente ya está trabajando.')
  agentStarts.add(request.id)
  try {
    await directory(request.cwd)
    const catalog = request.provider === 'zai' ? await connectionCatalog(request.connectionId, false, request.model) : await catalogs.get(request.provider)
    if (cancelledAgents.has(request.id)) return
    const access = permissions(request.permissions)
    const browserMcp = await browserHub.configureAgent(request.id, request.provider, access)
    if (cancelledAgents.has(request.id)) return
    browserHub.setActive(request.id, true)
    try {
      if (request.provider === 'zai') { const selected = request.model || catalog.defaults.model; return await zaiRuntime.send({ ...request, model: selected, vision: catalog.models.find((m) => m.id === selected)?.vision === true, permissions: access }) }
      return await agents.send({ ...request, permissions: access, browserMcp, ...resolveSelection(catalog, request) })
    }
    catch (error) { browserHub.setActive(request.id, false); throw error }
  } finally { agentStarts.delete(request.id); cancelledAgents.delete(request.id) }
})
handle('agent:stop', (id) => { if (validId(id)) { if (agentStarts.has(id)) { cancelledAgents.add(id); emit('agent:event', { id, type: 'status', status: 'stopped' }) } browserHub.setActive(id, false); zaiRuntime.stop(id); return agents.stop(id) } })
handle('agent:close', (id) => { if (validId(id)) { if (agentStarts.has(id)) cancelledAgents.add(id); browserHub.closeAgent(id); zaiRuntime.close(id); agents.close(id) } })
handle('agent:respond', (id, requestId, response) => {
  if (!validId(id) || typeof requestId !== 'string') throw new Error('Respuesta inválida')
  if (requestId.startsWith('zai-')) return zaiRuntime.respond(id, requestId, response)
  if (requestId.startsWith('browser-')) return browserHub.respond(requestId, response, id)
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
app.whenReady().then(async () => {
  protocol.handle('zai-asset', async (request) => {
    try { const url = new URL(request.url); if (url.hostname !== 'background' || url.search || url.hash) return new Response('', { status: 404 }); const data = await backgrounds.read(url.pathname.slice(1)); return new Response(data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'Access-Control-Allow-Origin': '*' } }) } catch { return new Response('', { status: 404 }) }
  })
  await createWindow()
})
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
app.on('window-all-closed', () => app.quit())
function shutdown() {
  if (quitting) return
  quitting = true
  zaiRuntime.dispose()
  apiProfiles.dispose()
  backgrounds.cancel()
  agents.dispose()
  catalogs.dispose()
  browserHub.dispose()
  browserController.dispose()
  for (const terminal of terminals.values()) terminal.pty.kill()
  Promise.allSettled([saving, graphicsSaving]).finally(() => app.quit())
}
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitRequested = true
  if (window && !window.isDestroyed() && rendererReady && !closeConfirmed) window.close()
  else shutdown()
})
module.exports = { browserHub }

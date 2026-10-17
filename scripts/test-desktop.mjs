import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const data = await mkdtemp(path.join(tmpdir(), 'zai-desktop-test-'))
const folder = path.join(data, 'project')
await mkdir(folder)
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<!doctype html><title>Prueba aislada de Zai</title><h1>El navegador funciona.</h1>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
let application
const errors = []
const launch = async () => {
  const instance = await _electron.launch({
    ...(process.env.ZAI_TEST_EXECUTABLE ? { executablePath: process.env.ZAI_TEST_EXECUTABLE } : {}),
    args: [...(process.env.ZAI_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), ...(process.env.ZAI_TEST_EXECUTABLE ? [] : [root])],
    env: { ...process.env, ZAI_USER_DATA: data, ZAI_TEST: '1', ZAI_DEV_URL: '' },
  })
  application = instance
  const page = await instance.firstWindow()
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '¿Qué construimos hoy?' }).waitFor()
  return { application: instance, page }
}
try {
  let session = await launch()
  application = session.application
  let page = session.page
  expect(await page.evaluate(() => typeof window.zai.send)).toBe('function')
  const catalogs = await page.evaluate(async () => Promise.all(['codex', 'claude'].map((provider) => window.zai.catalog(provider))))
  for (const catalog of catalogs) {
    expect(Array.isArray(catalog.models)).toBe(true)
    expect(Array.isArray(catalog.usage.windows)).toBe(true)
    expect(typeof catalog.defaults.model).toBe('string')
  }
  console.log('✓ Catálogos y uso de ambos proveedores a través del puente de escritorio')
  await page.locator('.save-status.saved').waitFor()
  await page.evaluate(async (folder) => {
    const workspace = await window.zai.load()
    workspace.projects[0].folder = folder
    await window.zai.save(workspace)
  }, folder)
  await page.reload()
  await page.getByRole('heading', { name: '¿Qué construimos hoy?' }).waitFor()
  await expect(page.locator('.folder-button')).toContainText('project')
  await page.getByRole('button', { name: 'Encuadrar pizarra', exact: true }).click()
  await page.getByLabel('Contenido de la nota').fill('Nota conservada al reiniciar Electron')
  await page.getByLabel('Dirección del navegador').fill(url)
  await page.getByLabel('Dirección del navegador').press('Enter')
  const guest = () => application.evaluate(({ webContents }) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
    return guest ? { id: guest.id, title: guest.getTitle(), url: guest.getURL(), preferences: guest.getLastWebPreferences() } : null
  })
  await expect.poll(async () => (await guest())?.title, { timeout: 20_000 }).toBe('Prueba aislada de Zai')
  const embedded = await guest()
  expect(embedded.preferences.nodeIntegration).toBe(false)
  expect(embedded.preferences.contextIsolation).toBe(true)
  expect(embedded.preferences.sandbox).toBe(true)
  const isolation = await application.evaluate(async ({ webContents }, id) => webContents.fromId(id).executeJavaScript('({ bridge: typeof window.zai, node: typeof require })'), embedded.id)
  expect(isolation).toEqual({ bridge: 'undefined', node: 'undefined' })
  await page.getByRole('button', { name: 'Minimizar Navegador', exact: true }).click()
  await page.getByRole('button', { name: 'Restaurar Navegador', exact: true }).click()
  expect((await guest()).id).toBe(embedded.id)
  console.log('✓ Navegador real, aislamiento y sesión conservada al minimizar')

  await page.getByRole('button', { name: 'Añadir Terminal', exact: true }).click()
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminalId = await page.evaluate(async () => {
    window.__zaiTestOutput = ''
    window.zai.onTerminalData(({ data }) => { window.__zaiTestOutput += data })
    const workspace = await window.zai.load()
    return workspace.projects[0].panels.find((panel) => panel.kind === 'terminal')?.id
  })
  // Wait for the renderer's debounced save before reading the new panel ID.
  let id = terminalId
  if (!id) {
    await page.locator('.save-status.saved').waitFor()
    id = await page.evaluate(async () => (await window.zai.load()).projects[0].panels.find((panel) => panel.kind === 'terminal').id)
  }
  await page.evaluate(({ id }) => window.zai.writeTerminal(id, 'echo zai-terminal-ok > zai-terminal-check.txt\r'), { id })
  await expect.poll(async () => {
    try { return (await readFile(path.join(folder, 'zai-terminal-check.txt'), 'utf8')).trim() }
    catch { return '' }
  }, { timeout: 10_000 }).toBe('zai-terminal-ok')
  await expect.poll(() => page.evaluate(() => window.__zaiTestOutput)).toContain('zai-terminal-ok')
  await page.getByRole('button', { name: 'Cerrar Terminal', exact: true }).click()
  console.log('✓ Terminal nativa ejecutada en la carpeta del proyecto')

  await page.locator('.save-status.saved').waitFor()
  const disk = JSON.parse(await readFile(path.join(data, 'workspace.json'), 'utf8'))
  expect(disk.projects[0].panels.find((panel) => panel.kind === 'note').note).toBe('Nota conservada al reiniciar Electron')
  expect(disk.projects[0].panels.find((panel) => panel.kind === 'browser').url).toBe(url)
  await page.getByLabel('Contenido de la nota').fill('Último cambio guardado al cerrar')
  await application.close()
  application = null
  session = await launch()
  application = session.application
  page = session.page
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Último cambio guardado al cerrar')
  console.log('✓ Persistencia en disco y restauración tras cerrar Electron')
  expect(errors).toEqual([])
  console.log('✓ Sin errores de ejecución en la interfaz')
} finally {
  if (application) await application.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(data, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
}

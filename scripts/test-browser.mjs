import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const data = await mkdtemp(path.join(tmpdir(), 'zai-browser-test-'))
await mkdir(path.join(data, 'codex'))
const site = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><title>Prueba MCP de Zai</title><style>body{font:18px sans-serif;padding:24px}input,button,select{font:inherit;margin:10px;padding:10px}</style><h1>Navegador conectado</h1><form onsubmit="event.preventDefault();document.getElementById('result').textContent='Guardado: '+document.getElementById('name').value"><label>Nombre<input id="name"></label><button type="submit">Guardar</button></form><label>Color<select id="color"><option value="green">Verde</option><option value="blue">Azul</option></select></label><input aria-label="Contraseña" type="password" value="never-in-snapshot"><p id="result">Sin guardar</p><div style="height:1800px"></div>`)
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${site.address().port}/`
let app
try {
  app = await _electron.launch({ ...(process.env.ZAI_TEST_EXECUTABLE ? { executablePath: process.env.ZAI_TEST_EXECUTABLE } : {}),
    args: [...(process.env.ZAI_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), ...(process.env.ZAI_TEST_EXECUTABLE ? [] : [root])],
    env: { ...process.env, CODEX_HOME: path.join(data, 'codex'), ZAI_USER_DATA: data, ZAI_TEST: '1', ZAI_DEV_URL: '' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
  await page.getByRole('heading', { name: '¿Qué construimos hoy?' }).waitFor()
  await page.getByRole('button', { name: 'Encuadrar pizarra', exact: true }).click()
  const from = page.getByLabel('Conectar Navegador · lado derecho', { exact: true }), to = page.getByLabel('Conectar Codex · lado izquierdo', { exact: true })
  const a = (await from.boundingBox()), b = (await to.boundingBox())
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('browser-connection')).toHaveCount(1)
  await page.locator('.save-status.saved').waitFor()
  const ids = await page.evaluate(async () => {
    const workspace = await window.zai.load(), project = workspace.projects[0]
    return { agentId: project.panels.find((p) => p.kind === 'codex').id, browserId: project.panels.find((p) => p.kind === 'browser').id }
  })
  // Obtain a temporary, scoped MCP client as a local test controller. No model inference.
  const config = await app.evaluate(async ({ app }, { root, ids }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
    const { browserHub } = require(app.getAppPath() + '/electron/main.cjs')
    const config = await browserHub.configureAgent(ids.agentId, 'codex', { browserAccess: 'control' })
    browserHub.setActive(ids.agentId, true)
    return config
  }, { root, ids })
  let sequence = 0
  const rpc = async (method, params = {}) => {
    const response = await fetch(config.url, { method: 'POST', headers: { ...config.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    expect(response.status).toBe(200)
    return (await response.json()).result
  }
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: name === 'zai_browser_list' ? {} : { browserId: ids.browserId, ...args } })
  const snapshot = async () => {
    const result = await call('zai_browser_snapshot')
    expect(result.isError, result.content?.[0]?.text).not.toBe(true)
    return JSON.parse(result.content[0].text)
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'zai_test', version: '1' } })
  expect(JSON.parse((await call('zai_browser_list')).content[0].text).map((item) => item.id)).toEqual([ids.browserId])
  const loaded = await call('zai_browser_navigate', { url })
  expect(loaded.isError, loaded.content?.[0]?.text).not.toBe(true)
  await expect(page.locator('.wire-completed')).toHaveCount(1)
  await expect(page.locator('.connection-pulses')).toHaveCount(1)
  let state = await snapshot()
  expect(state.text).toContain('Navegador conectado')
  expect(JSON.stringify(state)).not.toContain('never-in-snapshot')
  const name = state.elements.find((item) => item.tag === 'input' && item.type !== 'password')
  expect((await call('zai_browser_fill', { ref: name.ref, value: 'Hola conexiones' })).isError).not.toBe(true)
  state = await snapshot()
  const submit = state.elements.find((item) => item.tag === 'button' && item.name === 'Guardar')
  expect((await call('zai_browser_click', { ref: submit.ref })).isError).not.toBe(true)
  await expect.poll(async () => (await snapshot()).text).toContain('Guardado: Hola conexiones')
  state = await snapshot()
  const color = state.elements.find((item) => item.tag === 'select')
  expect((await call('zai_browser_select', { ref: color.ref, value: 'blue' })).isError).not.toBe(true)
  state = await snapshot()
  expect(state.elements.find((item) => item.tag === 'select').options.find((option) => option.value === 'blue').selected).toBe(true)
  const focusedName = state.elements.find((item) => item.tag === 'input' && item.type !== 'password')
  await call('zai_browser_fill', { ref: focusedName.ref, value: 'Enviado con Enter' })
  expect((await call('zai_browser_press', { key: 'Enter' })).isError).not.toBe(true)
  await expect.poll(async () => (await snapshot()).text).toContain('Guardado: Enviado con Enter')
  const image = await call('zai_browser_screenshot')
  expect(image.content[0].type).toBe('image')
  expect(image.content[0].data.length).toBeGreaterThan(1000)
  const isolation = await app.evaluate(async ({ webContents }) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
    return guest.executeJavaScript('({bridge:typeof window.zai,node:typeof require,refs:typeof window.__zaiBrowserRefs})')
  })
  expect(isolation).toEqual({ bridge: 'undefined', node: 'undefined', refs: 'undefined' })
  console.log('✓ MCP controla el Chromium real: navegación, lectura, formulario, captura y pulsos del hilo')
  console.log('✓ El sitio no recibe el puente, Node, ni las referencias del controlador aislado')

  await page.getByRole('button', { name: 'Minimizar Navegador', exact: true }).click()
  state = await snapshot()
  expect(state.text).toContain('Guardado: Enviado con Enter')
  const minimizedImage = await call('zai_browser_screenshot')
  expect(minimizedImage.isError, minimizedImage.content?.[0]?.text).not.toBe(true)
  expect(minimizedImage.content[0].type).toBe('image')
  console.log('✓ La conexión sigue funcionando con el navegador minimizado')

  await page.getByRole('button', { name: 'Conexión Codex con Navegador', exact: true }).focus()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('browser-connection')).toHaveCount(0)
  await page.locator('.save-status.saved').waitFor()
  const revoked = await call('zai_browser_snapshot')
  expect(revoked.isError).toBe(true)
  expect(revoked.content[0].text).toContain('no está conectado')
  console.log('✓ Quitar el hilo revoca el acceso al navegador')
} finally {
  if (app) await app.close()
  await new Promise((resolve) => site.close(resolve))
  await rm(data, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
}

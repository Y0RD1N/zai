import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const data = await mkdtemp(path.join(tmpdir(), 'zai-api-desktop-'))
const folder = path.join(data, 'project'); await mkdir(folder)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPwjqr9TwlmGDVg1IBRA4aLAQAtXiEfKf8pbQAAAABJRU5ErkJggg==', 'base64')
const imagePath = path.join(data, 'local.png'); await writeFile(imagePath, png)
let browserId = '', base = '', application, releaseNavigation
const calls = [], errors = []
const tool = (res, id, name, args) => stream(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }])
const stream = (res, chunks) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`); res.end('data: [DONE]\n\n') }
const server = createServer(async (req, res) => {
  if (req.url === '/page' || req.url === '/slow') {
    if (req.url === '/slow') await new Promise((resolve) => { releaseNavigation = resolve })
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>Browser fixture</title><h1>Página aislada para Zai</h1>'); return
  }
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}; calls.push({ url: req.url, body })
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture', name: 'Modelo de prueba', reasoning: { supported_efforts: ['low', 'high'] } }] })); return }
  if (req.url === '/v1/images/generations') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })); return }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return }
  const last = body.messages.at(-1)
  if (last.role === 'user' && last.content === 'crea y revisa') return tool(res, 'file', 'write_file', { path: 'created.txt', content: 'Archivo creado por el motor de Zai.' })
  if (last.role === 'tool' && last.tool_call_id === 'file') return tool(res, 'list', 'zai_browser_list', {})
  if (last.role === 'tool' && last.tool_call_id === 'list') { browserId = JSON.parse(last.content)[0].id; return tool(res, 'snapshot', 'zai_browser_snapshot', { browserId }) }
  if (last.role === 'user' && last.content === 'navega') return tool(res, 'nav', 'zai_browser_navigate', { browserId, url: base + '/slow' })
  if (last.role === 'user' && last.content === 'cancela') return tool(res, 'cancel-file', 'write_file', { path: 'must-not-exist.txt', content: 'No.' })
  stream(res, [{ choices: [{ delta: { content: 'Trabajo terminado y comprobado.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 8 } }])
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`
try {
  application = await _electron.launch({ ...(process.env.ZAI_TEST_EXECUTABLE ? { executablePath: process.env.ZAI_TEST_EXECUTABLE } : {}), args: [...(process.env.ZAI_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), ...(process.env.ZAI_TEST_EXECUTABLE ? [] : [root])], env: { ...process.env, ZAI_USER_DATA: data, ZAI_TEST: '1', ZAI_DEV_URL: '' } })
  const page = await application.firstWindow(); page.on('pageerror', (e) => errors.push(e.message))
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
  await page.getByRole('heading', { name: '¿Qué construimos hoy?' }).waitFor()
  await expect.poll(async () => page.evaluate(() => window.zai.load())).not.toBeNull()
  await page.evaluate(async ({ folder, base }) => {
    const profile = await window.zai.saveAPIProfile({ name: 'Motor de prueba', kind: 'compatible', baseUrl: base + '/v1', model: 'fixture', apiKey: 'not-a-real-key' })
    await window.zai.saveAPIProfile({ name: 'Imágenes de prueba', kind: 'image-api', baseUrl: base + '/v1', model: 'image-fixture', apiKey: 'not-a-real-image-key' })
    const workspace = await window.zai.load(), p = workspace.projects[0]
    p.folder = folder; p.zoom = .9; p.pan = { x: 170, y: 170 }
    const agent = p.panels.find((v) => v.kind === 'codex'), browser = p.panels.find((v) => v.kind === 'browser')
    Object.assign(agent, { kind: 'zai', title: 'Zai Agent', connectionId: profile.id, x: 0, y: 0, width: 500, height: 580, permissions: { ...agent.permissions, zaiMode: 'ask', browserAccess: 'control' } })
    Object.assign(browser, { x: 560, y: 0, width: 500, height: 520, url: base + '/page' })
    p.panels = [agent, browser]; p.connections = [{ id: 'fixture-edge', agentId: agent.id, browserId: browser.id, agentSide: 'right', browserSide: 'left' }]
    await window.zai.save(workspace)
  }, { folder, base })
  await page.reload()
  const panel = page.getByTestId('panel-zai'), input = page.getByLabel('Mensaje para Zai Agent', { exact: true })
  await expect(panel).toBeVisible()
  await expect(page.getByLabel('Conexión de Zai Agent', { exact: true })).toContainText('Motor de prueba')
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getAllWebContents().find((v) => v.getType() === 'webview')?.getTitle())).toBe('Browser fixture')
  await input.fill('crea y revisa'); await input.press('Enter')
  await panel.getByText('Permitir edición de Zai', { exact: true }).waitFor()
  let missing = false; try { await readFile(path.join(folder, 'created.txt')) } catch (e) { missing = e.code === 'ENOENT' }; expect(missing).toBe(true)
  await panel.getByRole('button', { name: 'Permitir una vez', exact: true }).click()
  await expect(panel.getByText('Trabajo terminado y comprobado.', { exact: true })).toHaveCount(1)
  expect(await readFile(path.join(folder, 'created.txt'), 'utf8')).toContain('motor de Zai')
  expect(calls.some((c) => c.body.messages?.at(-1)?.tool_call_id === 'snapshot' && c.body.messages.at(-1).content.includes('Página aislada'))).toBe(true)
  expect(await panel.locator('[data-chat-item]').evaluateAll((els) => els.map((el) => el.getAttribute('data-chat-item')))).toEqual(['user', 'tool', 'tool', 'tool', 'assistant'])
  console.log('✓ Zai Agent: proveedor API, aprobación real, archivos, navegador y orden del historial')
  await input.fill('continúa'); await input.press('Enter')
  await expect(panel.getByText('Trabajo terminado y comprobado.', { exact: true })).toHaveCount(2)
  expect(calls.filter((c) => c.url === '/v1/chat/completions').at(-1).body.messages.some((m) => m.tool_call_id === 'snapshot')).toBe(true)
  await input.fill('cancela'); await input.press('Enter'); await panel.getByText('Permitir edición de Zai', { exact: true }).waitFor()
  await panel.getByRole('button', { name: 'Detener Zai Agent', exact: true }).click()
  await expect(panel.getByText('Detenido', { exact: true })).toBeVisible()
  missing = false; try { await readFile(path.join(folder, 'must-not-exist.txt')) } catch (e) { missing = e.code === 'ENOENT' }; expect(missing).toBe(true)
  console.log('✓ Reanudación de sesión y detención sin ejecutar la escritura pendiente')
  await input.fill('navega'); await input.press('Enter')
  const footer = page.getByTestId('panel-browser')
  await expect(footer.locator('.browser-footer')).toContainText('Espera a que termine')
  await footer.getByLabel('Gestionar conexiones del navegador').click()
  const disconnect = footer.getByRole('button', { name: 'Desconectar Zai Agent del navegador', exact: true })
  await expect(disconnect).toBeDisabled()
  const denied = await page.evaluate(async () => { const w = await window.zai.load(), p = w.projects[0]; try { await window.zai.disconnectBrowser(p.panels[0].id, p.panels[1].id); return false } catch { return true } })
  expect(denied).toBe(true)
  releaseNavigation()
  await expect(disconnect).toBeEnabled({ timeout: 15_000 }); await disconnect.click()
  await expect(page.getByTestId('browser-connection')).toHaveCount(0)
  console.log('✓ Desconexión bloqueada mientras el navegador trabaja y disponible al quedar libre')
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Preferencias', exact: true })
  await settings.getByRole('button', { name: 'Crear con IA', exact: true }).click()
  await settings.getByLabel('Motor para generar fondos', { exact: true }).click()
  await page.getByRole('option', { name: 'Imágenes de prueba', exact: true }).click()
  await settings.getByLabel('Descripción del fondo', { exact: true }).fill('Fondo de prueba local sin inferencia real.')
  await settings.getByRole('button', { name: 'Generar fondo', exact: true }).click()
  await expect(settings.getByAltText('Vista previa del fondo')).toBeVisible()
  await expect.poll(() => settings.getByAltText('Vista previa del fondo').evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
  await application.evaluate(({ dialog }, imagePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] }) }, imagePath)
  const generated = await settings.getByAltText('Vista previa del fondo').getAttribute('src')
  await settings.getByRole('button', { name: 'Tu imagen', exact: true }).click()
  await expect(settings.getByAltText('Vista previa del fondo')).not.toHaveAttribute('src', generated)
  await settings.getByLabel('Color de fondo', { exact: true }).fill('#253343')
  const graphics = await page.evaluate(() => window.zai.graphics())
  expect(typeof graphics.hardware).toBe('boolean'); expect(typeof graphics.features.gpu_compositing).toBe('string')
  await settings.getByLabel('Aceleración por hardware', { exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('vuelvas a abrir Zai')
  const pref = JSON.parse(await readFile(path.join(data, 'graphics.json'), 'utf8')); expect(pref.mode).toBe('off')
  await settings.getByLabel('Aceleración por hardware', { exact: true }).click()
  await settings.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
  await page.locator('.save-status.saved').waitFor()
  const saved = await page.evaluate(() => window.zai.load())
  expect(JSON.stringify(saved).includes('not-a-real-key')).toBe(false); expect(saved.background.color).toBe('#253343')
  const publicProfiles = await page.evaluate(() => window.zai.apiProfiles())
  expect(JSON.stringify(publicProfiles).includes('not-a-real-key')).toBe(false)
  const vault = await readFile(path.join(data, 'api-profiles.json'), 'utf8'); expect(vault.includes('not-a-real-key')).toBe(false)
  await page.reload(); await expect(page.locator('.canvas-background-image')).toBeVisible()
  await expect.poll(() => page.locator('.canvas-background-image').evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
  expect(errors).toEqual([])
  console.log(`✓ Fondos generados/importados, protocolo de imágenes, persistencia, claves aisladas y diagnóstico GPU (${graphics.hardware ? 'hardware' : 'software'})`)
} finally {
  releaseNavigation?.()
  await application?.close().catch(() => {}); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(data, { recursive: true, force: true })
}

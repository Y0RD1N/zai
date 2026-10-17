import { expect, test } from '@playwright/test'
import { chooseOption } from './select'

test('color de fondo personalizable persiste y se puede restaurar el tema', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click()
  await page.getByLabel('Color de fondo', { exact: true }).fill('#283746')
  await expect(page.locator('.canvas')).toHaveCSS('background-color', 'rgb(40, 55, 70)')
  await page.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
  await page.locator('.save-status.saved').waitFor()
  await page.reload()
  await expect(page.locator('.canvas')).toHaveCSS('background-color', 'rgb(40, 55, 70)')
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click()
  await page.getByRole('button', { name: 'Usar el fondo del tema', exact: true }).click()
  await expect(page.locator('.canvas')).not.toHaveCSS('background-color', 'rgb(40, 55, 70)')
})

test('Zai Agent se añade, elige permisos y se conecta al navegador', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Añadir Zai Agent', exact: true }).click()
  const agent = page.getByTestId('panel-zai')
  await expect(agent.getByRole('heading', { name: 'Una idea. Todas las posibilidades.' })).toBeVisible()
  await page.getByLabel('Conectar Zai Agent · lado derecho', { exact: true }).focus(); await page.keyboard.press('Enter')
  await page.getByLabel('Conectar Navegador · lado izquierdo', { exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('browser-connection')).toHaveCount(1)
  await agent.getByRole('button', { name: 'Configurar permisos de Zai Agent', exact: true }).click()
  await chooseOption(page, 'Permisos de Zai Agent', 'plan')
  await expect(agent.getByLabel('Permisos de Zai Agent', { exact: true })).toHaveAttribute('data-value', 'plan')
  await agent.getByRole('button', { name: 'Cerrar configuración de Zai Agent', exact: true }).click()
  await page.getByTestId('panel-browser').getByLabel('Gestionar conexiones del navegador').click()
  await page.getByRole('button', { name: 'Desconectar Zai Agent del navegador', exact: true }).click()
  await expect(page.getByTestId('browser-connection')).toHaveCount(0)
})

test('arrastrar un chat largo conserva contenido y mueve cables sin commits por cada movimiento', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as typeof window & { commitCount: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
    w.commitCount = 0
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject: () => 1, onCommitFiberRoot: () => { w.commitCount++ }, onCommitFiberUnmount: () => {}, checkDCE: () => {} }
  })
  await page.goto('/'); await page.locator('.save-status.saved').waitFor()
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('zai.workspace.v1')!)
    const p = w.projects[0], agent = p.panels[0]
    p.pan = { x: 310, y: 150 }; p.zoom = .9
    agent.messages = Array.from({ length: 60 }, (_, i) => ({ id: `m-${i}`, role: 'assistant', text: `**Mensaje ${i}**\n\n| Archivo | Estado |\n| --- | --- |\n| src/main.ts | Completado |\n\n~~~ts\nconst message = '${i}'\n~~~\n`, time: Date.now() }))
    agent.timeline = agent.messages.map((m: { id: string }) => ({ kind: 'message', id: m.id }))
    p.panels = [agent, { ...p.panels[2], x: 550, y: 0 }]; p.connections = [{ id: 'perf-edge', agentId: agent.id, browserId: p.panels[1].id, agentSide: 'right', browserSide: 'left' }]
    localStorage.setItem('zai.workspace.v1', JSON.stringify(w))
  })
  await page.reload(); await expect(page.locator('.message')).toHaveCount(60)
  const panel = page.getByTestId('panel-codex'), title = (await panel.locator('.panel-titlebar').boundingBox())!
  await page.mouse.move(title.x + 100, title.y + 20); await page.mouse.down()
  await page.waitForTimeout(80)
  const count = await page.evaluate(() => (window as typeof window & { commitCount: number }).commitCount)
  expect(count).toBeGreaterThan(0)
  const before = await panel.boundingBox()
  await page.mouse.move(title.x + 230, title.y + 100, { steps: 35 })
  await expect.poll(() => panel.evaluate((el) => el.style.transform)).toContain('translate3d')
  const after = (await panel.boundingBox())!
  expect(after.x - before!.x).toBeCloseTo(130, 0)
  const midCount = await page.evaluate(() => (window as typeof window & { commitCount: number }).commitCount)
  expect(midCount - count).toBeLessThanOrEqual(2)
  const wireEnd = await page.locator('.connection-stroke').evaluate((el) => { const p = el as SVGPathElement; const at = p.getPointAtLength(0).matrixTransform(p.getScreenCTM()!); return { x: at.x, y: at.y } })
  const port = (await page.getByLabel('Conectar Codex · lado derecho', { exact: true }).boundingBox())!
  expect(wireEnd.x).toBeCloseTo(port.x + port.width / 2, 0)
  await page.mouse.up()
  await expect(panel).toHaveCSS('transform', 'none')
  await expect(panel).toHaveCSS('will-change', 'auto')
  await page.locator('.save-status.saved').waitFor(); await page.reload()
  await expect(page.locator('.message')).toHaveCount(60)
  expect((await panel.boundingBox())!.x).toBeCloseTo(after.x, 0)
})

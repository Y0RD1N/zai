import { expect, test } from '@playwright/test'
import type { Workspace } from '../src/types'

for (const density of [1, 1.25, 2]) test.describe(`Densidad ${density}`, () => {
  test.use({ deviceScaleFactor: density })

  test('el zoom fraccionario conserva posición, arrastre, menús y conexiones', async ({ page }) => {
    await page.goto('/')
    await page.locator('.save-status.saved').waitFor()
    await page.evaluate(() => {
      const w = JSON.parse(localStorage.getItem('zai.workspace.v1')!) as Workspace
      const p = w.projects[0]
      p.zoom = 1.0828125; p.pan = { x: 305.531, y: 90.247 }
      p.panels = [
        { ...p.panels.find((panel) => panel.kind === 'claude')!, x: 10.169, y: 24.786, width: 459.163059, height: 435.01443 },
        { ...p.panels.find((panel) => panel.kind === 'browser')!, x: 560.23, y: 110.789, width: 450, height: 320 },
      ]
      localStorage.setItem('zai.workspace.v1', JSON.stringify(w))
    })
    await page.reload()
    const panel = page.getByTestId('panel-claude')
    await expect(panel).toBeVisible()
    const before = (await panel.boundingBox())!
    expect(before.x).toBeCloseTo(305.531 + 10.169 * 1.0828125, 0)
    expect(before.y).toBeCloseTo(64 + 90.247 + 24.786 * 1.0828125, 0)
    expect(before.width).toBeCloseTo(459.163059 * 1.0828125, 0)
    const title = (await panel.locator('.panel-titlebar').boundingBox())!
    await page.mouse.move(title.x + 110, title.y + 20); await page.mouse.down()
    await page.mouse.move(title.x + 147, title.y + 43, { steps: 6 }); await page.mouse.up()
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(before.x + 37, 0)
    await expect.poll(async () => (await panel.boundingBox())!.y).toBeCloseTo(before.y + 23, 0)
    const grip = (await page.getByLabel('Redimensionar Claude', { exact: true }).boundingBox())!
    await page.mouse.move(grip.x + 7, grip.y + 7); await page.mouse.down()
    await page.mouse.move(grip.x + 52, grip.y + 38, { steps: 6 }); await page.mouse.up()
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(before.width + 45, 0)

    await panel.getByRole('button', { name: 'Configurar modelo de Claude', exact: true }).click()
    const model = page.getByRole('combobox', { name: 'Modelo de Claude', exact: true })
    await model.click()
    const trigger = (await model.boundingBox())!, menu = (await page.locator('.agent-select-popover').boundingBox())!
    expect(menu.x).toBeCloseTo(trigger.x, 0)
    expect(menu.y).toBeGreaterThanOrEqual(0)
    expect(menu.y + menu.height).toBeLessThanOrEqual(1000)
    await page.getByRole('option', { name: 'Otro modelo…', exact: true }).click()
    await expect(page.getByLabel('Identificador de modelo de Claude', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar configuración de Claude', exact: true }).click()

    await page.getByLabel('Conectar Claude · lado izquierdo', { exact: true }).click()
    await page.getByLabel('Conectar Navegador · lado derecho', { exact: true }).click()
    await expect(page.getByTestId('browser-connection')).toHaveCount(1)
    await page.mouse.move(800, 760); await page.keyboard.down('Control')
    await page.mouse.wheel(0, -85); await page.keyboard.up('Control')
    await expect(page.locator('.zoom-label')).not.toHaveText('108%')
    const endpoints = await page.locator('.connection-stroke').evaluate((el) => {
      const path = el as SVGPathElement, matrix = path.getScreenCTM()!
      return [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())].map((point) => {
        const p = point.matrixTransform(matrix); return { x: p.x, y: p.y }
      })
    })
    for (const [index, label] of ['Conectar Claude · lado izquierdo', 'Conectar Navegador · lado derecho'].entries()) {
      const port = (await page.getByLabel(label, { exact: true }).boundingBox())!
      expect(endpoints[index].x).toBeCloseTo(port.x + port.width / 2, 0)
      expect(endpoints[index].y).toBeCloseTo(port.y + port.height / 2, 0)
    }
  })
})

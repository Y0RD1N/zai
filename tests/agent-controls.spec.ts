import { expect, test } from '@playwright/test'
import type { Provider } from '../src/types'

async function mockAgents(page: import('@playwright/test').Page, noLimits = false) {
  await page.addInitScript(({ noLimits }) => {
    let listener: (event: unknown) => void = () => {}
    const catalog = (provider: string) => ({
      models: [
        { id: `${provider}-balanced`, name: 'Modelo equilibrado', description: 'Catálogo de prueba', isDefault: true, defaultEffort: 'medium', efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }], speeds: [{ id: 'default', name: 'Estándar' }, { id: provider === 'codex' ? 'priority' : 'fast', name: 'Rápida' }] },
        { id: `${provider}-basic`, name: 'Modelo básico', description: '', isDefault: false, defaultEffort: '', efforts: [], speeds: [{ id: 'default', name: 'Estándar' }] },
      ], defaults: { model: `${provider}-balanced`, effort: 'medium' },
      usage: { windows: [{ id: '5h', label: '5 horas', usedPercent: 25, resetsAt: Date.now() + 3600000 }, { id: 'week', label: 'Semanal', usedPercent: null, resetsAt: null }, { id: 'month', label: 'Mensual', usedPercent: 68, resetsAt: Date.now() + 86400000 }], updatedAt: Date.now() }, updatedAt: Date.now(),
    })
    Object.defineProperty(window, 'zai', { value: {
      load: async () => null, save: async () => {},
      info: async () => ({ platform: 'linux', version: 'test', home: '/tmp' }),
      providers: async () => ({ codex: { installed: true }, claude: { installed: true } }),
      catalog: async (provider: string) => { const data = catalog(provider); return noLimits ? { ...data, usage: { windows: [], updatedAt: Date.now(), note: 'Esta conexión no publica límites de cuenta.' } } : data }, onProvider: () => () => {},
      chooseFolder: async () => '/tmp/zai-test',
      onAgent: (callback: (event: unknown) => void) => { listener = callback; return () => {} },
      send: async (request: { id: string; provider: string }) => {
        localStorage.setItem(`request-${request.provider}`, JSON.stringify(request))
        const id = request.id
        listener({ id, type: 'message', messageId: 'comment', text: 'Voy a revisar el proyecto.', delta: false })
        listener({ id, type: 'tool', tool: { id: 'read', name: 'Read', detail: 'app.ts', status: 'running' } })
        listener({ id, type: 'tool', tool: { id: 'read', status: 'completed', output: 'Contenido del archivo' } })
        listener({ id, type: 'message', messageId: 'final', text: 'Resultado ', delta: true })
        listener({ id, type: 'message', messageId: 'final', text: 'final.', delta: true })
        listener({ id, type: 'message', messageId: 'final', text: 'Resultado final.', delta: false })
        listener({ id, type: 'status', status: 'idle' })
      },
    } })
  }, { noLimits })
}

for (const provider of ['codex', 'claude'] as Provider[]) {
  const title = provider === 'codex' ? 'Codex' : 'Claude'
  test(`${title}: las opciones se envían al agente y el historial conserva su secuencia`, async ({ page }) => {
    await mockAgents(page)
    await page.goto('/')
    const panel = page.getByTestId(`panel-${provider}`)
    await panel.getByRole('button', { name: `Configurar modelo de ${title}`, exact: true }).click()
    await panel.getByLabel(`Modelo de ${title}`, { exact: true }).selectOption(`${provider}-balanced`)
    await panel.getByLabel(`Esfuerzo de ${title}`, { exact: true }).selectOption('high')
    await panel.getByLabel(`Velocidad de ${title}`, { exact: true }).selectOption(provider === 'codex' ? 'priority' : 'fast')
    await panel.getByRole('button', { name: `Cerrar configuración de ${title}`, exact: true }).click()
    await page.getByRole('button', { name: 'Vincular carpeta', exact: true }).click()
    await panel.getByLabel(`Mensaje para ${title}`).fill('Revisar')
    await panel.getByRole('button', { name: `Enviar a ${title}`, exact: true }).click()
    const request = await page.evaluate((provider) => JSON.parse(localStorage.getItem(`request-${provider}`)!), provider)
    expect(request.model).toBe(`${provider}-balanced`)
    expect(request.effort).toBe('high')
    expect(request.speed).toBe(provider === 'codex' ? 'priority' : 'fast')
    await expect(panel.getByText('Resultado final.', { exact: true })).toBeVisible()
    expect(await panel.locator('[data-chat-item]').evaluateAll((items) => items.map((item) => item.getAttribute('data-chat-item')))).toEqual(['user', 'assistant', 'tool', 'assistant'])
    await expect(panel.locator('[data-tool-id="read"]')).toHaveCount(1)
    await panel.locator('.tool-card summary').click()
    await expect(panel.getByText('Contenido del archivo', { exact: true })).toBeVisible()
    await page.getByText('Guardado localmente', { exact: true }).waitFor()
    await page.reload()
    expect(await panel.locator('[data-chat-item]').evaluateAll((items) => items.map((item) => item.getAttribute('data-chat-item')))).toEqual(['user', 'assistant', 'tool', 'assistant'])
    await panel.getByRole('button', { name: `Configurar modelo de ${title}`, exact: true }).click()
    await expect(panel.getByLabel(`Esfuerzo de ${title}`, { exact: true })).toHaveValue('high')
    await panel.getByLabel(`Modelo de ${title}`, { exact: true }).selectOption(`${provider}-basic`)
    await expect(panel.getByLabel(`Esfuerzo de ${title}`, { exact: true })).toBeDisabled()
    await expect(panel.getByLabel(`Velocidad de ${title}`, { exact: true })).toHaveValue('default')
    await expect(panel.getByLabel(`Velocidad de ${title}`, { exact: true })).toBeDisabled()
  })
}

test('el uso distingue las ventanas de cuota y los porcentajes no disponibles', async ({ page }) => {
  await mockAgents(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ver uso de Codex', exact: true }).click()
  const options = page.getByRole('region', { name: 'Configuración de Codex' })
  await expect(options.getByRole('progressbar', { name: '5 horas de Codex' })).toHaveAttribute('aria-valuenow', '25')
  await expect(options.getByRole('progressbar', { name: 'Mensual de Codex' })).toHaveAttribute('aria-valuenow', '68')
  await expect(options.getByText('Sin porcentaje', { exact: true })).toBeVisible()
  await expect(options.getByRole('progressbar', { name: 'Semanal de Codex' })).toHaveCount(0)
  await options.getByRole('button', { name: 'Actualizar modelos y uso de Codex', exact: true }).click()
  await expect(options.getByRole('progressbar', { name: '5 horas de Codex' })).toBeVisible()
})

test('una conexión sin límites no presenta porcentajes inventados', async ({ page }) => {
  await mockAgents(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ver uso de Claude', exact: true }).click()
  const options = page.getByRole('region', { name: 'Configuración de Claude' })
  await expect(options.getByText('Esta conexión no publica límites de cuenta.', { exact: true })).toBeVisible()
  await expect(options.getByRole('progressbar')).toHaveCount(0)
})

test('la barra recupera ventanas fuera de vista y de otros proyectos sin perder borradores', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Mensaje para Codex').fill('Borrador conservado')
  await page.getByRole('button', { name: 'Minimizar Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Minimizar Claude', exact: true }).click()
  await page.keyboard.down('Space')
  await page.mouse.move(1480, 740)
  await page.mouse.down()
  await page.mouse.move(240, 480, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click()
  await page.getByLabel('Nombre del proyecto').fill('Otra estancia')
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click()
  await page.getByLabel('Ventanas minimizadas (2)', { exact: true }).click()
  await page.getByRole('button', { name: 'Mostrar Codex · Zai', exact: true }).click()
  const panel = page.getByTestId('panel-codex').filter({ visible: true })
  await expect(panel.getByLabel('Mensaje para Codex')).toHaveValue('Borrador conservado')
  const bounds = (await panel.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(64)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1600)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
  await expect(page.getByLabel('Ventanas minimizadas (1)', { exact: true })).toBeVisible()
})

test('el título del proyecto queda detrás de una ventana que lo cubre', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByTestId('panel-codex')
  const title = (await panel.locator('.panel-titlebar').boundingBox())!
  await page.mouse.move(title.x + 110, title.y + 20)
  await page.mouse.down()
  await page.mouse.move(420, 96, { steps: 8 })
  await page.mouse.up()
  const heading = (await page.locator('.project-heading').boundingBox())!
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), { x: heading.x + 35, y: heading.y + 35 })
  expect(top).toBe('panel-codex')
  await panel.getByLabel('Mensaje para Codex').fill('La ventana recibe interacción')
})

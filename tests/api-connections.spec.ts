import { expect, test } from '@playwright/test'
import type { APIProfile, APIProfileInput } from '../src/types'
import { chooseOption } from './select'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const profiles: APIProfile[] = JSON.parse(localStorage.getItem('test.api-profiles') || '[]')
    let agentEvent: (event: unknown) => void = () => {}
    const persist = () => localStorage.setItem('test.api-profiles', JSON.stringify(profiles))
    Object.defineProperty(window, 'zai', { value: {
      load: async () => null, save: async () => {},
      info: async () => ({ platform: 'linux', version: 'test', home: '/tmp' }),
      providers: async () => ({}), catalog: async () => ({ models: [], defaults: {}, usage: { windows: [] } }),
      onProvider: () => () => {}, onAgent: (callback: (event: unknown) => void) => { agentEvent = callback; return () => {} },
      chooseFolder: async () => '/tmp/zai-test',
      send: async (request: { id: string }) => { localStorage.setItem('test.api-request', JSON.stringify(request)); agentEvent({ id: request.id, type: 'status', status: 'idle' }) },
      apiProfiles: async () => profiles,
      saveAPIProfile: async (input: APIProfileInput) => {
        const previous = profiles.findIndex((p) => p.id === input.id)
        const profile: APIProfile = { id: input.id || `profile-${profiles.length + 1}`, kind: input.kind, name: input.name, baseUrl: input.baseUrl, model: input.model, hasKey: !!input.apiKey || !!profiles[previous]?.hasKey, storage: 'encrypted' }
        if (previous < 0) profiles.push(profile); else profiles[previous] = profile
        persist(); return profile
      },
      deleteAPIProfile: async (id: string) => { const index = profiles.findIndex((p) => p.id === id); if (index >= 0) profiles.splice(index, 1); persist() },
      apiCatalog: async () => ({ models: [{ id: 'fixture', name: 'Modelo de prueba', isDefault: true, defaultEffort: 'high', contextWindow: 128000, maxOutputTokens: 16384, reasoningBudget: true, efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }], speeds: [{ id: 'default', name: 'Estándar' }, { id: 'latency', name: 'Menor latencia' }] }, { id: 'basic', name: 'Modelo básico', isDefault: false, efforts: [], speeds: [{ id: 'default', name: 'Estándar' }] }], defaults: { model: 'fixture' }, usage: { windows: [] } }),
    } })
  })
})

test('conexión vacía muestra proveedores, configura la clave y selecciona la conexión guardada', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Añadir Zai Agent', exact: true }).click()
  const panel = page.getByTestId('panel-zai')
  const connection = panel.getByRole('combobox', { name: 'Conexión de Zai Agent', exact: true })
  await connection.click()
  const menu = page.locator('.agent-select-popover')
  for (const name of ['DeepSeek', 'OpenRouter', 'Ollama Cloud', 'Ollama local', 'API de chat compatible']) {
    await expect(menu.getByRole('option', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('option', { name: 'OpenRouter', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Conexiones de IA', exact: true })
  await expect(dialog.getByLabel('Proveedor de la conexión', { exact: true })).toHaveAttribute('data-value', 'openrouter')
  await expect(dialog.getByLabel('Dirección del proveedor', { exact: true })).toHaveValue('https://openrouter.ai/api/v1')
  await expect(dialog.getByLabel('Clave API', { exact: true })).toHaveAttribute('type', 'password')
  await dialog.getByRole('button', { name: 'Guardar conexión', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Clave API', { exact: true })).toBeFocused()
  await dialog.getByLabel('Nombre de la conexión', { exact: true }).fill('Mi OpenRouter')
  await dialog.getByLabel('Clave API', { exact: true }).fill('fake-key-only-for-ui-test')
  await dialog.getByRole('button', { name: 'Guardar conexión', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(connection).toHaveAttribute('data-value', 'profile-1')
  await expect(connection).toContainText('Mi OpenRouter')
  await panel.getByRole('button', { name: 'Configurar conexiones de IA', exact: true }).click()
  await dialog.getByRole('button', { name: 'Mi OpenRouter OpenRouter · Clave cifrada', exact: true }).click()
  await expect(dialog.getByLabel('Clave API', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('Clave API', { exact: true })).toHaveAttribute('placeholder', 'Conservar la clave guardada')
  await dialog.getByLabel('Nombre de la conexión', { exact: true }).fill('Router del proyecto')
  await dialog.getByRole('button', { name: 'Guardar conexión', exact: true }).click()
  await expect(connection).toContainText('Router del proyecto')
  await page.locator('.save-status.saved').waitFor()
  await page.reload()
  await expect(connection).toHaveAttribute('data-value', 'profile-1')
  await expect(connection).toContainText('Router del proyecto')
  expect(await page.evaluate(() => localStorage.getItem('zai.workspace.v1'))).not.toContain('fake-key-only-for-ui-test')
})

test('configurar conexiones abre los proveedores directamente y permite un motor local sin clave', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Añadir Zai Agent', exact: true }).click()
  const panel = page.getByTestId('panel-zai')
  await panel.getByRole('button', { name: 'Configurar conexiones de IA', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Conexiones de IA', exact: true })
  await dialog.getByRole('button', { name: 'Ollama local', exact: false }).click()
  await expect(dialog.getByLabel('Dirección del proveedor', { exact: true })).toHaveValue('http://localhost:11434')
  await expect(dialog.getByLabel('Clave API', { exact: true })).not.toHaveAttribute('required')
  await dialog.getByRole('button', { name: 'Guardar conexión', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByLabel('Conexión de Zai Agent', { exact: true })).toContainText('Ollama local')
  await chooseOption(page, 'Conexión de Zai Agent', 'new:deepseek')
  await expect(dialog.getByLabel('Dirección del proveedor', { exact: true })).toHaveValue('https://api.deepseek.com')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByLabel('Conexión de Zai Agent', { exact: true })).toHaveAttribute('data-value', 'profile-1')
})


test('los esfuerzos, prioridades y presupuestos de API se configuran y llegan al mensaje', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Añadir Zai Agent', exact: true }).click()
  await chooseOption(page, 'Conexión de Zai Agent', 'new:openrouter')
  const dialog = page.getByRole('dialog', { name: 'Conexiones de IA', exact: true })
  await dialog.getByLabel('Clave API', { exact: true }).fill('fake-test-key')
  await dialog.getByRole('button', { name: 'Guardar conexión', exact: true }).click()
  const panel = page.getByTestId('panel-zai')
  await panel.getByRole('button', { name: 'Configurar modelo de Zai Agent', exact: true }).click()
  await expect(panel.getByLabel('Esfuerzo de Zai Agent', { exact: true })).toContainText('Auto · Alto')
  await chooseOption(page, 'Esfuerzo de Zai Agent', 'max')
  await chooseOption(page, 'Velocidad de Zai Agent', 'latency')
  await panel.getByText('Más opciones de generación', { exact: true }).click()
  await panel.getByLabel('Límite de salida de Zai Agent', { exact: true }).fill('8192')
  await panel.getByLabel('Presupuesto de razonamiento de Zai Agent', { exact: true }).fill('4096')
  await expect(panel.getByLabel('Esfuerzo de Zai Agent', { exact: true })).toHaveAttribute('data-value', '')
  await panel.getByRole('button', { name: 'Cerrar configuración de Zai Agent', exact: true }).click()
  await page.getByRole('button', { name: 'Vincular carpeta', exact: true }).click()
  const input = panel.getByLabel('Mensaje para Zai Agent', { exact: true })
  await input.fill('Revisar con presupuesto'); await input.press('Enter')
  let request = await page.evaluate(() => JSON.parse(localStorage.getItem('test.api-request')!))
  expect(request.speed).toBe('latency'); expect(request.generation).toEqual({ maxOutputTokens: 8192, reasoningBudget: 4096 })
  await panel.getByRole('button', { name: 'Configurar modelo de Zai Agent', exact: true }).click()
  await chooseOption(page, 'Esfuerzo de Zai Agent', 'low')
  await expect(panel.getByLabel('Presupuesto de razonamiento de Zai Agent', { exact: true })).toHaveValue('')
  await panel.getByRole('button', { name: 'Cerrar configuración de Zai Agent', exact: true }).click()
  await input.fill('Revisar con esfuerzo'); await input.press('Enter')
  request = await page.evaluate(() => JSON.parse(localStorage.getItem('test.api-request')!))
  expect(request.effort).toBe('low'); expect(request.generation).toEqual({ maxOutputTokens: 8192 })
  await page.locator('.save-status.saved').waitFor(); await page.reload()
  await panel.getByRole('button', { name: 'Configurar modelo de Zai Agent', exact: true }).click()
  await expect(panel.getByLabel('Límite de salida de Zai Agent', { exact: true })).toHaveValue('8192')
  await chooseOption(page, 'Modelo de Zai Agent', 'basic')
  await expect(panel.getByLabel('Esfuerzo de Zai Agent', { exact: true })).toBeDisabled()
  await expect(panel.getByLabel('Presupuesto de razonamiento de Zai Agent', { exact: true })).toHaveCount(0)
  await panel.getByText('Más opciones de generación', { exact: true }).click()
  await expect(panel.getByLabel('Límite de salida de Zai Agent', { exact: true })).toHaveValue('')
})

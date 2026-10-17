import { expect, test } from '@playwright/test'
import type { Workspace } from '../src/types'

test('los controles de las ventanas quedan accesibles en una pantalla pequeña', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Minimizar Navegador', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restaurar Navegador', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restaurar Navegador', exact: true }).click()
  await expect(page.getByTestId('panel-browser')).toBeVisible()
})

test('mover, redimensionar y minimizar conserva la ventana y el borrador', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByTestId('panel-codex')
  const title = panel.locator('.panel-titlebar')
  await page.getByLabel('Mensaje para Codex').fill('Borrador que debe sobrevivir')
  const before = await panel.boundingBox()
  const handle = await title.boundingBox()
  await page.mouse.move(handle!.x + 100, handle!.y + 20)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 195, handle!.y + 55, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(before!.x + 95, 0)
  const grip = await panel.getByRole('separator').boundingBox()
  await page.mouse.move(grip!.x + 8, grip!.y + 8)
  await page.mouse.down()
  await page.mouse.move(grip!.x + 68, grip!.y + 43, { steps: 7 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(before!.width + 60, 0)
  await page.getByRole('button', { name: 'Minimizar Codex', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: 'Restaurar Codex', exact: true }).click()
  await expect(page.getByLabel('Mensaje para Codex')).toHaveValue('Borrador que debe sobrevivir')
})

test('los proyectos separan sus ventanas y las notas sobreviven a la recarga', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Contenido de la nota').fill('Plan persistente del proyecto Zai')
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click()
  await page.getByLabel('Nombre del proyecto').fill('Proyecto independiente')
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click()
  await expect(page.getByText('Haz espacio para')).toBeVisible()
  await expect(page.getByTestId('panel-codex')).toBeHidden()
  await page.getByRole('button', { name: 'Añadir Notas de la idea', exact: true }).click()
  await page.getByLabel('Contenido de la nota').filter({ visible: true }).fill('Otra idea en otra estancia')
  await page.getByText('Guardado localmente', { exact: true }).waitFor()
  await page.reload()
  await expect(page.getByLabel('Contenido de la nota').filter({ visible: true })).toHaveValue('Otra idea en otra estancia')
  await page.getByRole('button', { name: 'Abrir proyecto Zai', exact: true }).click()
  await expect(page.getByLabel('Contenido de la nota').filter({ visible: true })).toHaveValue('Plan persistente del proyecto Zai')
})

test('la barra y la sección de proyectos se pueden mover y restablecer', async ({ page }) => {
  await page.goto('/')
  const side = page.getByRole('complementary', { name: 'Proyectos' })
  const box = (await side.boundingBox())!
  await page.mouse.move(box.x + 95, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 160, box.y + 80, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await side.boundingBox())!.x).toBeCloseTo(box.x + 65, 0)
  const dock = page.locator('.canvas-dock')
  const oldDock = (await dock.boundingBox())!
  const grip = (await page.getByRole('button', { name: 'Mover barra de herramientas' }).boundingBox())!
  await page.mouse.move(grip.x + 8, grip.y + 8)
  await page.mouse.down()
  await page.mouse.move(grip.x - 70, grip.y - 70, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeLessThan(oldDock.y - 50)
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click()
  await page.getByRole('button', { name: 'Restablecer', exact: true }).click()
  await page.getByLabel('Cerrar diálogo').click()
  await expect.poll(async () => (await side.boundingBox())!.x).toBeCloseTo(box.x, 0)
})

test('la importación añade proyectos sin sustituir los existentes ni sus sesiones', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Guardado localmente', { exact: true }).waitFor()
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('zai.workspace.v1')!) as Workspace)
  snapshot.projects[0].folder = '/carpeta/no/autorizada'
  snapshot.projects[0].panels[0].sessionId = 'sesion-ajena'
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'respaldo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) })
  await expect(page.locator('.project-item')).toHaveCount(2)
  await page.getByText('Guardado localmente', { exact: true }).waitFor()
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('zai.workspace.v1')!) as Workspace)
  expect(imported.projects[1].id).not.toBe(snapshot.projects[0].id)
  expect(imported.projects[1].folder).toBe('')
  expect(imported.projects[1].panels[0].sessionId).toBeUndefined()
})

test('un chat procesa eventos estructurados y solicita permiso sin ejecutarlo automáticamente', async ({ page }) => {
  await page.addInitScript(() => {
    let listener: (event: unknown) => void = () => {}
    const bridge = {
      load: async () => null, save: async () => {},
      info: async () => ({ platform: 'linux', version: 'test', home: '/tmp' }),
      providers: async () => ({ codex: { installed: true }, claude: { installed: true } }),
      chooseFolder: async () => '/tmp/zai-test',
      onAgent: (callback: (event: unknown) => void) => { listener = callback; return () => {} },
      send: async ({ id }: { id: string }) => {
        listener({ id, type: 'status', status: 'running' })
        listener({ id, type: 'session', sessionId: 'test-thread' })
        listener({ id, type: 'message', messageId: 'answer-1', text: 'Primera ', delta: true })
        listener({ id, type: 'message', messageId: 'answer-1', text: 'respuesta.', delta: true })
        listener({ id, type: 'approval', approval: { requestId: 'approval-1', title: 'Codex solicita permiso', detail: 'npm test', kind: 'item/commandExecution/requestApproval' } })
      },
      respond: async (id: string, _requestId: string, response: { allow: boolean }) => {
        if (response.allow) localStorage.setItem('test-approved', 'yes')
        listener({ id, type: 'resolved', requestId: 'approval-1' })
        listener({ id, type: 'status', status: 'idle' })
      },
    }
    Object.defineProperty(window, 'zai', { value: bridge })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Vincular carpeta', exact: true }).click()
  await page.getByLabel('Mensaje para Codex').fill('Tarea de prueba')
  await page.getByRole('button', { name: 'Enviar a Codex' }).click()
  await expect(page.getByText('Primera respuesta.', { exact: true })).toBeVisible()
  await expect(page.getByText('Codex solicita permiso', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('test-approved'))).toBeNull()
  await page.getByRole('button', { name: 'Permitir una vez' }).click()
  await expect(page.getByText('Codex solicita permiso', { exact: true })).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('test-approved'))).toBe('yes')
  await page.getByText('Guardado localmente', { exact: true }).waitFor()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zai.workspace.v1')!) as Workspace)
  expect(saved.projects[0].panels[0].sessionId).toBe('test-thread')
  expect(saved.projects[0].panels[0].messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
})

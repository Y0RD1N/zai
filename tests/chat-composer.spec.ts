import { expect, test } from '@playwright/test'
import { initialWorkspace, makePanel } from '../src/model'
import type { ChatSubmission, Provider } from '../src/types'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPwjqr9TwlmGDVg1IBRA4aLAQAtXiEfKf8pbQAAAABJRU5ErkJggg==', 'base64')
for (const provider of ['codex', 'claude', 'zai'] as Provider[]) {
  test(`${provider}: contexto, compactación, autocompletado e imágenes con citas sobreviven a recargar`, async ({ page }) => {
    const workspace = initialWorkspace(), project = workspace.projects[0], panel = makePanel(provider)
    Object.assign(project, { folder: '/fixture/project', pan: { x: 320, y: 130 }, zoom: 1 })
    Object.assign(panel, { x: 0, y: 0, width: 600, height: 620, sessionId: 'saved', connectionId: 'profile', context: { usedTokens: 24000, windowTokens: 128000, estimated: false, updatedAt: Date.now() }, messages: [{ id: 'u', role: 'user', text: 'Tarea original', time: Date.now() }, { id: 'a', role: 'assistant', text: 'Primera respuesta', time: Date.now() }], timeline: undefined })
    project.panels = [panel]
    // Delayed frames reproduce cursor jumps when a user types while the board is busy.
    await page.addInitScript(() => {
      const frame = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (callback) => frame((time) => { setTimeout(() => callback(time), 180) })
    })
    await page.addInitScript(({ workspace }) => {
      if (!localStorage.getItem('zai.workspace.v1')) localStorage.setItem('zai.workspace.v1', JSON.stringify(workspace))
      let event: (value: unknown) => void = () => {}, sequence = 0
      const catalog = () => ({ models: [{ id: 'fixture', name: 'Fixture', description: '', isDefault: true, efforts: [], speeds: [{ id: 'default', name: 'Estándar' }], vision: true }], defaults: { model: 'fixture' }, usage: { windows: [] } })
      Object.defineProperty(window, 'zai', { value: {
        load: async () => null, save: async () => {}, info: async () => ({ platform: 'linux', version: 'test', home: '/tmp' }), providers: async () => ({}), catalog: async () => catalog(), onProvider: () => () => {}, syncBrowserGraph: async () => {},
        apiProfiles: async () => [{ id: 'profile', name: 'Fixture', kind: 'openrouter', model: 'fixture', baseUrl: 'https://fixture.invalid', hasKey: true }], apiCatalog: async () => catalog(),
        onAgent: (callback: (value: unknown) => void) => { event = callback; return () => {} },
        composerOptions: async () => ({ commands: [{ name: 'compact', action: 'compact', description: 'Compactar' }, { name: 'native-fixture', description: 'Comando anunciado por el agente' }], skills: [{ name: 'probe', description: 'Skill anunciada por el agente' }], apps: [] }),
        composerFiles: async (_cwd: string, query: string) => ['src/file with spaces.ts'].filter((path) => path.includes(query)),
        attachImage: async () => ({ id: '11111111-1111-1111-1111-111111111111.png', name: 'captura.png', mimeType: 'image/png', width: 16, height: 16, bytes: 100 }),
        send: async (request: ChatSubmission & { id: string }) => {
          const requests = JSON.parse(localStorage.getItem('composer-requests') || '[]'); requests.push(request); localStorage.setItem('composer-requests', JSON.stringify(requests))
          event({ id: request.id, type: 'session', sessionId: 'saved' })
          if (request.action === 'compact') event({ id: request.id, type: 'context', context: { usedTokens: 4000, windowTokens: 128000, estimated: true, compacting: false, updatedAt: Date.now() } })
          else event({ id: request.id, type: 'message', messageId: `reply-${++sequence}`, text: 'Revisada @imagen1.', delta: false })
          event({ id: request.id, type: 'status', status: 'idle' })
        },
      } })
    }, { workspace })
    await page.goto('/')
    const view = page.getByTestId(`panel-${provider}`), input = view.getByLabel(`Mensaje para ${panel.title}`, { exact: true })
    await view.getByRole('button', { name: `Ver contexto de ${panel.title}`, exact: true }).click()
    await expect(view.getByRole('progressbar', { name: 'Contexto ocupado' })).toHaveAttribute('aria-valuenow', '19')
    await view.getByRole('button', { name: 'Compactar contexto', exact: true }).click()
    await expect(view.getByRole('progressbar', { name: 'Contexto ocupado' })).toHaveAttribute('aria-valuenow', '3')
    await expect(view.locator('[data-chat-item]')).toHaveCount(2)
    await view.getByRole('button', { name: 'Cerrar contexto', exact: true }).click()
    await input.fill('/native')
    await expect(view.getByRole('option', { name: '/native-fixture', exact: false })).toBeVisible()
    await input.press('Tab'); await expect(input).toHaveValue('/native-fixture ')
    await input.fill('$pr'); await input.press('ArrowDown'); await input.press('Enter')
    await expect(input).toHaveValue('$probe ')
    await input.pressSequentially('@src/', { delay: 55 })
    await expect(view.getByRole('option', { name: '@src/file with spaces.ts', exact: false })).toBeVisible()
    await input.press('Tab')
    await expect(input).toHaveValue('$probe @"src/file with spaces.ts" ')
    await view.getByLabel(`Seleccionar imágenes para ${panel.title}`, { exact: true }).setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: png })
    await view.getByRole('button', { name: 'Citar imagen1', exact: true }).click()
    await expect(input).toHaveValue(/@imagen1/)
    await view.getByRole('button', { name: `Enviar a ${panel.title}`, exact: true }).click()
    await expect(view.getByText('Revisada', { exact: false }).first()).toBeVisible()
    const requests = await page.evaluate(() => JSON.parse(localStorage.getItem('composer-requests')!))
    expect(requests[0].action).toBe('compact')
    expect(requests[1].attachments).toHaveLength(1); expect(requests[1].attachments[0].reference).toBe('imagen1')
    expect(requests[1].references).toEqual(['src/file with spaces.ts'])
    expect(requests[1].text).toContain('$probe'); expect(requests[1].text).toContain('@imagen1')
    await page.getByText('Guardado localmente', { exact: true }).waitFor()
    await page.reload()
    await expect(view.getByRole('button', { name: 'Citar imagen1', exact: true })).toBeVisible()
    await view.getByRole('button', { name: 'Citar imagen1', exact: true }).click()
    await view.getByRole('button', { name: `Enviar a ${panel.title}`, exact: true }).click()
    const referenced = await page.evaluate(() => JSON.parse(localStorage.getItem('composer-requests')!).at(-1))
    expect(referenced.attachments).toHaveLength(1); expect(referenced.attachments[0].reference).toBe('imagen1')
    await view.locator('a[href="zai-image:imagen1"]').first().click()
    await expect(page.getByRole('dialog', { name: 'Imagen 1', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Imagen 1', exact: true })).toHaveCount(0)
  })
}

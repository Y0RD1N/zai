const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createBrowserHub } = require('../electron/browser-hub.cjs')
const { permissions, codexTurnPermissions, browserPermission } = require('../electron/permissions.cjs')

const projects = [{ id: 'project', panels: [{ id: 'codex', kind: 'codex' }, { id: 'claude', kind: 'claude' }, { id: 'browser', kind: 'browser' }, { id: 'unlinked', kind: 'browser' }], connections: [{ id: 'edge', agentId: 'codex', browserId: 'browser' }] },
  { id: 'other', panels: [{ id: 'foreign', kind: 'browser' }], connections: [] }]
function setup(t, overrides = {}) {
  const events = [], agentEvents = [], calls = []
  const hub = createBrowserHub({ describe: (id) => ({ url: `https://${id}.test`, ready: true }),
    perform: async (...args) => { calls.push(args); return { content: [{ type: 'text', text: 'OK' }] } }, emit: (event) => events.push(event), agentEvent: (event) => agentEvents.push(event), ...overrides })
  hub.sync(projects)
  t.after(() => hub.dispose())
  return { hub, events, agentEvents, calls }
}

test('los permisos se validan y Codex recibe límites de escritura y red explícitos', () => {
  assert.throws(() => permissions({ codexSandbox: 'arbitrary' }), /inválido/)
  assert.throws(() => permissions({ codexNetwork: 'true' }), /inválido/)
  assert.deepEqual(codexTurnPermissions({ codexSandbox: 'read-only', codexApproval: 'never' }, '/project'), { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
  assert.deepEqual(codexTurnPermissions({ codexNetwork: true }, '/project').sandboxPolicy, { type: 'workspaceWrite', writableRoots: ['/project'], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true })
  assert.equal(browserPermission('codex', { browserAccess: 'control', codexSandbox: 'read-only' }, true), 'deny')
  assert.equal(browserPermission('claude', { browserAccess: 'control', claudeMode: 'plan' }, true), 'deny')
  assert.equal(browserPermission('claude', { claudeMode: 'dontAsk' }, true), 'deny')
})

test('solo se accede a navegadores conectados del mismo proyecto', async (t) => {
  const { hub, calls } = setup(t)
  await hub.configureAgent('codex', 'codex', { browserAccess: 'control' }); hub.setActive('codex', true)
  const list = JSON.parse((await hub.execute('codex', 'zai_browser_list', {})).content[0].text)
  assert.deepEqual(list.map((item) => item.id), ['browser'])
  for (const id of ['unlinked', 'foreign']) await assert.rejects(hub.execute('codex', 'zai_browser_snapshot', { browserId: id }), /no está conectado/)
  assert.equal(calls.length, 0)
  assert.throws(() => hub.sync([{ ...projects[0], connections: [{ id: 'cross', agentId: 'codex', browserId: 'foreign' }] }, projects[1]]), /mismo proyecto/)
})

test('una acción espera permiso y desconectar revoca la solicitud pendiente', async (t) => {
  const { hub, agentEvents, calls } = setup(t)
  await hub.configureAgent('codex', 'codex'); hub.setActive('codex', true)
  const pending = hub.execute('codex', 'zai_browser_navigate', { browserId: 'browser', url: 'https://browser.test' })
  await new Promise(setImmediate)
  const request = agentEvents.find((event) => event.type === 'approval')
  assert.ok(request)
  assert.equal(calls.length, 0)
  assert.equal(hub.respond(request.approval.requestId, { allow: true }, 'claude'), false)
  hub.sync([{ ...projects[0], connections: [] }, projects[1]])
  await assert.rejects(pending, /rechazó/)
  assert.equal(calls.length, 0)
  assert.ok(agentEvents.some((event) => event.type === 'resolved'))
})

test('aprobar concede una sola acción; los pulsos se corresponden con trabajo real', async (t) => {
  const { hub, agentEvents, events, calls } = setup(t)
  await hub.configureAgent('codex', 'codex'); hub.setActive('codex', true)
  const pending = hub.execute('codex', 'zai_browser_click', { browserId: 'browser', ref: 'element' })
  await new Promise(setImmediate)
  assert.equal(events.length, 0)
  hub.respond(agentEvents.find((event) => event.type === 'approval').approval.requestId, { allow: true }, 'codex')
  await pending
  assert.equal(calls.length, 1)
  assert.deepEqual(events.map((event) => event.phase), ['started', 'completed'])
  assert.equal(events[0].operationId, events[1].operationId)
  const second = hub.execute('codex', 'zai_browser_click', { browserId: 'browser', ref: 'element' })
  await new Promise(setImmediate)
  assert.equal(agentEvents.filter((event) => event.type === 'approval').length, 2)
  hub.setActive('codex', false)
  await assert.rejects(second, /rechazó/)
  assert.equal(calls.length, 1)
})

test('las acciones concurrentes de un navegador se serializan', async (t) => {
  let release, started = false
  const wait = new Promise((resolve) => { release = resolve })
  const order = []
  const { hub } = setup(t, { perform: async (_id, action) => { order.push(action); if (action === 'snapshot') { started = true; await wait }; return { content: [] } } })
  await hub.configureAgent('codex', 'codex', { browserAccess: 'control' }); hub.setActive('codex', true)
  const first = hub.execute('codex', 'zai_browser_snapshot', { browserId: 'browser' })
  const second = hub.execute('codex', 'zai_browser_screenshot', { browserId: 'browser' })
  await new Promise(setImmediate)
  assert.equal(started, true)
  assert.deepEqual(order, ['snapshot'])
  release(); await Promise.all([first, second])
  assert.deepEqual(order, ['snapshot', 'screenshot'])
})

test('MCP exige un token activo y rechaza llamadas desde páginas web', async (t) => {
  const { hub } = setup(t)
  const config = await hub.configureAgent('codex', 'codex', { browserAccess: 'control' }); hub.setActive('codex', true)
  const request = (headers = {}) => fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  assert.equal((await request()).status, 403)
  assert.equal((await request({ ...config.headers, Origin: 'https://evil.test' })).status, 403)
  const response = await request(config.headers)
  assert.equal(response.status, 200)
  assert.ok((await response.json()).result.tools.some((tool) => tool.name === 'zai_browser_snapshot'))
  hub.closeAgent('codex')
  assert.equal((await request(config.headers)).status, 403)
})

test('desconectar se bloquea durante acciones activas o en cola y se permite inmediatamente al terminar', async (t) => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const { hub } = setup(t, { perform: async () => { await pending; return { content: [] } } })
  await hub.configureAgent('codex', 'codex', { browserAccess: 'control' }); hub.setActive('codex', true)
  const first = hub.execute('codex', 'zai_browser_snapshot', { browserId: 'browser' })
  const second = hub.execute('codex', 'zai_browser_screenshot', { browserId: 'browser' })
  assert.throws(() => hub.disconnect('codex', 'browser'), /trabajando/)
  assert.throws(() => hub.sync([{ ...projects[0], connections: [] }, projects[1]]), /trabajando/)
  release(); await Promise.all([first, second])
  hub.disconnect('codex', 'browser')
  await assert.rejects(hub.execute('codex', 'zai_browser_snapshot', { browserId: 'browser' }), /no está conectado/)
})

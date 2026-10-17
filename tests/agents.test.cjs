const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CodexSession } = require('../electron/agents.cjs')

test('las aprobaciones esperan al usuario y conceden una sola operación', () => {
  const events = [], frames = []
  const session = new CodexSession({ id: 'test-chat', cwd: '/tmp' }, (event) => events.push(event))
  session.write = (frame) => frames.push(frame)
  session.receive({ id: 8, method: 'item/commandExecution/requestApproval', params: { command: 'npm test', threadId: 'thread' } })
  assert.equal(events[0].type, 'approval')
  assert.equal(frames.length, 0)
  session.respond('8', { allow: true })
  assert.deepEqual(frames, [{ id: 8, result: { decision: 'accept' } }])
  assert.throws(() => session.respond('8', { allow: true }), /ya no está pendiente/)
})

test('cancelar permisos no concede acceso al sistema de archivos', () => {
  const frames = []
  const session = new CodexSession({ id: 'test-chat', cwd: '/tmp' }, () => {})
  session.write = (frame) => frames.push(frame)
  session.receive({ id: 10, method: 'item/permissions/requestApproval', params: { permissions: { fileSystem: { write: ['/private'] } } } })
  session.respond('10', { allow: false })
  assert.deepEqual(frames[0].result, { permissions: {}, scope: 'turn' })
})

test('un turno fallido no se presenta como completado', () => {
  const events = []
  const session = new CodexSession({ id: 'test-chat', cwd: '/tmp' }, (event) => events.push(event))
  session.receive({ method: 'turn/completed', params: { turn: { status: 'failed', error: null } } })
  assert.equal(events.at(-1).type, 'error')
  assert.equal(events.some((event) => event.status === 'idle'), false)
})

test('las respuestas fragmentadas y las finales comparten el identificador', () => {
  const events = []
  const session = new CodexSession({ id: 'test-chat', cwd: '/tmp' }, (event) => events.push(event))
  session.receive({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'Hola' } })
  session.receive({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'answer', text: 'Hola mundo' } } })
  assert.deepEqual(events.map((event) => [event.messageId, event.delta]), [['answer', true], ['answer', false]])
})

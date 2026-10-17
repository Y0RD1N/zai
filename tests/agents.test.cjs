const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CodexSession, ClaudeSession } = require('../electron/agents.cjs')
const { codexModels, claudeModels, codexUsage, claudeUsage, claudeRateUsage, resolveSelection } = require('../electron/provider-data.cjs')
test('Codex mide el último contexto y compacta mediante la operación nativa', async () => {
  const events = [], calls = []
  const session = new CodexSession({ id: 'context', cwd: '/tmp' }, (event) => events.push(event))
  session.threadId = 'thread'
  session.rpc = async (method, params) => { calls.push({ method, params }); return {} }
  session.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', tokenUsage: { total: { inputTokens: 900000, outputTokens: 15000 }, last: { totalTokens: 24000 }, modelContextWindow: 128000 } } })
  const context = events.find((e) => e.type === 'context').context
  assert.equal(context.usedTokens, 24000); assert.equal(context.windowTokens, 128000)
  await session.compact()
  assert.deepEqual(calls, [{ method: 'thread/compact/start', params: { threadId: 'thread' } }])
  await assert.rejects(session.compact(), /termine el turno/)
  session.receive({ method: 'item/completed', params: { item: { id: 'compact', type: 'contextCompaction' } } })
  session.receive({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
  assert.equal(session.active, false)
  assert.equal(events.find((e) => e.tool?.id === 'compact').tool.status, 'completed')
  assert.equal(events.at(-1).status, 'idle')
})
test('Claude transmite imágenes nativas, consulta el contexto y reconoce la compactación real', async () => {
  const events = [], session = new ClaudeSession({ id: 'vision', cwd: '/tmp', sessionId: 'saved' }, (e) => events.push(e))
  let content, done
  const complete = new Promise((resolve) => { done = resolve })
  const consume = session.consume.bind(session)
  session.consume = async (...args) => { try { await consume(...args) } finally { done() } }
  session.query = ({ prompt }) => {
    const stream = (async function* () {
      for await (const message of prompt) content = message.message.content
      yield { type: 'system', subtype: 'init', model: 'claude-fixture' }
      yield { type: 'assistant', message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 5 } } }
      yield { type: 'system', subtype: 'compact_boundary', uuid: 'boundary', compact_metadata: { trigger: 'manual', pre_tokens: 135, post_tokens: 50 } }
      yield { type: 'result', modelUsage: { 'claude-fixture': { inputTokens: 9000, outputTokens: 2000, contextWindow: 200000 } } }
    })()
    stream.getContextUsage = async (options) => { assert.equal(options.detail, 'summary'); return { totalTokens: 55, rawMaxTokens: 200000 } }
    return stream
  }
  await session.send('Mira @imagen1', { images: [{ reference: 'imagen1', name: 'captura.png', mimeType: 'image/png', data: 'aGVsbG8=' }] })
  await complete
  assert.equal(content[2].type, 'image'); assert.equal(content[2].source.data, 'aGVsbG8=')
  assert.match(content[1].text, /@imagen1/)
  assert.equal(events.find((e) => e.context?.usedTokens === 135).context.estimated, false)
  const last = events.filter((e) => e.context?.usedTokens !== undefined).at(-1).context
  assert.equal(last.usedTokens, 55); assert.equal(last.windowTokens, 200000)
  assert.equal(events.some((e) => e.tool?.id === 'boundary' && e.tool.status === 'completed'), true)
})
test('los comandos locales de Claude muestran su salida y un reset adopta la nueva sesión', async () => {
  const events = [], session = new ClaudeSession({ id: 'command', cwd: '/tmp', sessionId: 'old' }, (event) => events.push(event))
  await session.consume((async function* () {
    yield { type: 'system', subtype: 'local_command_output', session_id: 'old', uuid: 'output', content: 'Salida nativa del comando.' }
    yield { type: 'conversation_reset', session_id: 'old', new_conversation_id: 'new' }
    yield { type: 'result', session_id: 'new', result: 'Conversación nueva.', is_error: false }
  })(), new AbortController())
  assert.equal(events.find((e) => e.messageId === 'output').text, 'Salida nativa del comando.')
  assert.equal(events.find((e) => e.type === 'reset').sessionId, 'new')
  assert.equal(session.sessionId, 'new')
  assert.equal(events.some((e) => e.text === 'Conversación nueva.'), true)
})

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

test('los límites usan su periodo real y distinguen datos ausentes de cero', () => {
  const usage = codexUsage({ rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null } })
  assert.equal(usage.windows.length, 1)
  assert.equal(usage.windows[0].label, 'Semanal')
  assert.equal(usage.windows[0].resetsAt, 1800000000000)
  const claude = claudeUsage({ rate_limits: { five_hour: { utilization: null }, seven_day: { utilization: 63, resets_at: '2027-01-01T00:00:00Z' }, extra_usage: { is_enabled: true, utilization: 9 } } })
  assert.equal(claude.windows[0].usedPercent, null)
  assert.equal(claude.windows[1].usedPercent, 63)
  assert.equal(claude.windows[2].label, 'Mensual · uso adicional')
  assert.equal(claudeRateUsage({ rateLimitType: 'five_hour', utilization: .63 }).windows[0].usedPercent, 63)
  assert.equal(claudeUsage({ rate_limits_available: false, rate_limits: null }).windows.length, 0)
})

test('solo se ofrecen esfuerzos y velocidades anunciados por cada proveedor', () => {
  const codex = codexModels([{ model: 'dynamic-model', displayName: 'Dynamic', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }], serviceTiers: [{ id: 'priority', name: 'Fast', description: '2x' }] }])
  const claude = claudeModels([{ value: 'custom', displayName: 'Custom', supportsEffort: false, supportsFastMode: false }])
  assert.deepEqual(codex[0].speeds.map((row) => row.id), ['default', 'priority'])
  assert.deepEqual(claude[0].efforts, [])
  assert.deepEqual(claude[0].speeds.map((row) => row.id), ['default'])
  const catalog = { models: codex, defaults: { model: 'dynamic-model', effort: 'low' } }
  assert.deepEqual(resolveSelection(catalog, { model: '', effort: '', speed: 'default' }), { model: 'dynamic-model', effort: 'low', speed: 'default' })
  assert.throws(() => resolveSelection(catalog, { model: 'dynamic-model', effort: 'ultra' }), /no admite/)
  assert.throws(() => resolveSelection({ models: claude, defaults: {} }, { model: 'custom', speed: 'fast' }), /no anuncia/)
})

test('Codex aplica modelo, esfuerzo y velocidad en cada turno y permite volver a estándar', async () => {
  const frames = []
  const session = new CodexSession({ id: 'test-chat', cwd: '/tmp' }, () => {})
  session.threadId = 'thread'; session.defaultModel = 'original'; session.defaultEffort = 'medium'
  session.rpc = async (method, params) => { frames.push({ method, params }); return { turn: { id: 'turn' } } }
  await session.send('Primero', { model: 'other', effort: 'high', speed: 'priority' })
  session.active = false
  await session.send('Segundo', { speed: 'default' })
  assert.equal(frames[0].params.model, 'other')
  assert.equal(frames[0].params.effort, 'high')
  assert.equal(frames[0].params.serviceTier, 'priority')
  assert.equal(frames[1].params.model, 'original')
  assert.equal(frames[1].params.effort, 'medium')
  assert.equal(frames[1].params.serviceTier, 'default')
})

test('Claude transmite esfuerzo y fast mode y conserva el orden de bloques de texto y herramientas', async () => {
  const events = []; let options
  const session = new ClaudeSession({ id: 'test-chat', cwd: '/tmp', sessionId: 'saved-session' }, (event) => events.push(event))
  const records = [
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'message' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Voy a revisar.' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'read', name: 'Read' } } },
    { type: 'assistant', message: { id: 'message', content: [{ type: 'text', text: 'Voy a revisar.' }, { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'app.ts' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read', content: 'archivo' }] } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Resultado final.' } } },
    { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: .5 } },
    { type: 'result', is_error: false, total_cost_usd: .01, modelUsage: { model: { inputTokens: 10, outputTokens: 20 } } },
  ]
  let done
  const finished = new Promise((resolve) => { done = resolve })
  const consume = session.consume.bind(session)
  session.consume = async (...args) => { try { await consume(...args) } finally { done() } }
  session.query = (request) => { options = request.options; return (async function* () { yield* records })() }
  await session.send('Revisar', { model: 'opus', effort: 'high', speed: 'fast' })
  await finished
  assert.equal(options.model, 'opus')
  assert.equal(options.effort, 'high')
  assert.deepEqual(options.settings, { fastMode: true })
  assert.equal(options.resume, 'saved-session')
  const transcript = events.filter((event) => ['message', 'tool'].includes(event.type))
  assert.deepEqual(transcript.map((event) => event.type), ['message', 'tool', 'tool', 'tool', 'message'])
  assert.notEqual(transcript[0].messageId, transcript.at(-1).messageId)
  assert.equal(transcript[0].text, 'Voy a revisar.')
  assert.equal(transcript.at(-1).text, 'Resultado final.')
  assert.equal(events.find((event) => event.type === 'usage').usage.windows[0].usedPercent, 50)
  assert.deepEqual(events.find((event) => event.type === 'metrics').metrics, { inputTokens: 10, outputTokens: 20, costUsd: .01 })
})

test('Claude aplica el modo nativo y solo habilita bypass cuando se elige explícitamente', async () => {
  for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']) {
    const session = new ClaudeSession({ id: 'permissions-test', cwd: '/tmp' }, () => {})
    let options, done
    const finished = new Promise((resolve) => { done = resolve })
    const consume = session.consume.bind(session)
    session.consume = async (...args) => { try { await consume(...args) } finally { done() } }
    session.query = (request) => { options = request.options; return (async function* () { yield { type: 'result', is_error: false } })() }
    await session.send('Tarea', { permissions: { claudeMode: mode }, browserMcp: { url: 'http://127.0.0.1:1234/mcp', headers: { Authorization: 'Bearer scoped-test-token' } } })
    await finished
    assert.equal(options.permissionMode, mode)
    assert.equal(options.allowDangerouslySkipPermissions === true, mode === 'bypassPermissions')
    assert.equal(options.mcpServers.zai_browser.type, 'http')
    assert.equal(options.mcpServers.zai_browser.alwaysLoad, true)
  }
})

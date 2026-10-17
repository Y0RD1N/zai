const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createAPIProfiles, endpoint } = require('../electron/api-profiles.cjs')
const { completion } = require('../electron/api-client.cjs')
const { apiCatalog } = require('../electron/api-catalog.cjs')
const { createZaiRuntime } = require('../electron/zai-runtime.cjs')
const { projectPath, performTool, validateArguments, definitions } = require('../electron/zai-tools.cjs')
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zai-api-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir }
async function server(t, handler) {
  const requests = []
  const server = http.createServer(async (req, res) => { let text = ''; for await (const data of req) text += data; const body = text ? JSON.parse(text) : undefined; requests.push({ url: req.url, body, auth: req.headers.authorization }); try { await handler(req.url, body, res, requests) } catch (e) { res.writeHead(500); res.end(e.message) } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) }); return { url: `http://127.0.0.1:${server.address().port}`, requests }
}
const send = (res, chunks) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`); res.end('data: [DONE]\n\n') }
const final = (text) => [{ choices: [{ delta: { content: text }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4, cost: .001 } }]

test('claves fuera de metadatos y cifradas; basic_text solo conserva clave en memoria', async (t) => {
  const directory = await temp(t)
  const secret = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (value) => Buffer.from(value.split('').reverse().join('')), decryptString: (value) => value.toString().split('').reverse().join('') }
  const vault = createAPIProfiles({ directory, safeStorage: secret })
  const profile = await vault.save({ kind: 'deepseek', name: 'Mi API', baseUrl: 'https://api.deepseek.com', model: '', apiKey: 'sensitive-fixture' })
  assert.equal(profile.storage, 'encrypted'); assert.equal(JSON.stringify(await vault.list()).includes('sensitive-fixture'), false)
  assert.equal((await vault.get(profile.id)).apiKey, 'sensitive-fixture')
  assert.equal((await fs.readFile(path.join(directory, 'api-profiles.json'), 'utf8')).includes('sensitive-fixture'), false)
  await vault.save({ ...profile, baseUrl: 'https://other.example/v1' })
  await assert.rejects(vault.get(profile.id), /API key/)
  const basic = createAPIProfiles({ directory, platform: 'linux', safeStorage: { ...secret, getSelectedStorageBackend: () => 'basic_text' } })
  const local = await basic.save({ kind: 'compatible', name: 'Sesión', baseUrl: 'http://localhost:1234/v1', model: 'local', apiKey: 'memory-only' })
  assert.equal(local.storage, 'session'); assert.equal((await basic.get(local.id)).apiKey, 'memory-only')
  assert.equal((await fs.readFile(path.join(directory, 'api-profiles.json'), 'utf8')).includes('memory-only'), false)
  basic.dispose(); assert.equal((await basic.get(local.id)).apiKey, '')
  for (const url of ['file:///tmp/a', 'https://name:pass@example.com', 'http://example.com', 'https://example.com?key=x', 'http://localhost.evil.test']) assert.throws(() => endpoint(url))
})

test('SSE conserva UTF-8, herramientas fragmentadas y reasoning_content de DeepSeek', async (t) => {
  const api = await server(t, (_url, body, res, requests) => {
    if (requests.length === 1) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const payload = [
        { choices: [{ delta: { content: '¡Hola! ', reasoning_content: 'analizar ', tool_calls: [{ index: 0, id: 'tool-1', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { reasoning_content: 'bien', tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] }, finish_reason: 'tool_calls' }] },
      ].map((v) => `data: ${JSON.stringify(v)}\n\n`).join('') + 'data: [DONE]\n\n'
      const bytes = Buffer.from(payload); for (const byte of bytes) res.write(Buffer.from([byte])); res.end()
    } else { assert.equal(body.messages[0].reasoning_content, 'analizar bien'); send(res, final('Listo.')) }
  })
  const p = { kind: 'deepseek', baseUrl: api.url, apiKey: 'mock' }, tools = definitions, messages = []
  let output = ''
  const first = await completion(p, { model: 'test', messages, tools, effort: 'high', onText: (v) => { output += v } })
  assert.equal(output, '¡Hola! '); assert.deepEqual(first.assistant.tool_calls[0].function, { name: 'read_file', arguments: '{"path":"a.txt"}' })
  assert.deepEqual(api.requests[0].body.thinking, { type: 'enabled' })
  await completion(p, { model: 'test', messages: [first.assistant, { role: 'tool', tool_call_id: 'tool-1', content: 'OK' }], tools, onText: () => {} })
})

test('OpenRouter conserva bloques de razonamiento y firmas; error dentro de HTTP200 falla', async (t) => {
  const api = await server(t, (_url, _body, res, requests) => {
    if (requests.length === 1) send(res, [{ choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'ab' }, { type: 'reasoning.encrypted', index: 1, data: 'signed' }] } }] }, { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'cd' }] }, finish_reason: 'stop' }] }])
    else send(res, [{ error: { message: 'provider failed' } }])
  })
  const p = { kind: 'openrouter', baseUrl: api.url, apiKey: 'mock' }
  const result = await completion(p, { model: 'test', messages: [], tools: [], onText: () => {} })
  assert.equal(result.assistant.reasoning_details[0].text, 'abcd'); assert.equal(result.assistant.reasoning_details[1].data, 'signed')
  assert.equal(api.requests[0].body.provider.require_parameters, true)
  await assert.rejects(completion(p, { model: 'test', messages: [], tools: [], onText: () => {} }), /provider failed/)
})

test('Ollama nativo conserva thinking y argumentos objeto, cuotas Cloud reales', async (t) => {
  const api = await server(t, (url, _body, res) => {
    if (url === '/api/chat') { res.writeHead(200); res.end(JSON.stringify({ message: { content: '', thinking: 'x', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'x' } } }] }, done: true, prompt_eval_count: 20, eval_count: 5 }) + '\n'); return }
    res.setHeader('Content-Type', 'application/json')
    if (url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'test:cloud' }] }))
    else if (url === '/api/show') res.end(JSON.stringify({ capabilities: ['tools', 'vision', 'thinking'], thinking: { values: ['low', 'high'] } }))
    else if (url === '/api/balance') res.end(JSON.stringify({ included: { balance_usd: 8, allowance_usd: 10 }, period: { until: '2026-11-01T00:00:00Z' } }))
  })
  const p = { kind: 'ollama-cloud', baseUrl: api.url, apiKey: 'mock', model: 'test:cloud' }
  const c = await apiCatalog(p); assert.equal(Math.round(c.usage.windows[0].usedPercent), 20); assert.equal(c.models[0].vision, true); assert.deepEqual(c.models[0].efforts.map((v) => v.id), ['low', 'high'])
  const result = await completion(p, { model: 'test:cloud', messages: [], tools: definitions, effort: 'high', onText: () => {} })
  assert.equal(result.assistant.thinking, 'x'); assert.deepEqual(result.assistant.tool_calls[0].function.arguments, { path: 'x' }); assert.equal(result.usage.prompt_tokens, 20)
  assert.equal(api.requests.at(-1).body.think, 'high')
})

test('rutas de archivo no escapan por .. o symlinks y se conservan respaldos de ediciones', async (t) => {
  const dir = await temp(t), cwd = path.join(dir, 'project'); await fs.mkdir(cwd)
  await fs.writeFile(path.join(dir, 'private.txt'), 'secret')
  await assert.rejects(projectPath(cwd, '../private.txt'), /dentro/)
  if (process.platform !== 'win32') { await fs.symlink(dir, path.join(cwd, 'escape')); await assert.rejects(projectPath(cwd, 'escape/private.txt'), /enlace/) }
  const backups = [], context = { cwd, signal: new AbortController().signal, checkpoint: async (...value) => backups.push(value) }
  await performTool('write_file', { path: 'new/a.txt', content: 'first' }, context)
  await performTool('edit_file', { path: 'new/a.txt', old_text: 'first', new_text: 'second' }, context)
  assert.deepEqual(backups, [['new/a.txt', null], ['new/a.txt', 'first']].map(([p, c]) => [p.replaceAll('/', path.sep), c]))
  assert.equal(await fs.readFile(path.join(cwd, 'new/a.txt'), 'utf8'), 'second')
  assert.throws(() => validateArguments(definitions[3].function.parameters, { path: 'x', content: 4 }), /tipo inválido/)
})

test('motor propio pide permiso, ejecuta navegador, reanuda contexto y revoca herramientas al detener', async (t) => {
  const directory = await temp(t), cwd = path.join(directory, 'project'); await fs.mkdir(cwd)
  const api = await server(t, (_url, body, res) => {
    const last = body.messages.at(-1)
    if (last.role === 'user' && last.content === 'start') send(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'write', function: { name: 'write_file', arguments: '{"path":"hello.txt","content":"hola"}' } }] }, finish_reason: 'tool_calls' }] }])
    else if (last.role === 'tool' && last.tool_call_id === 'write') send(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'browse', function: { name: 'zai_browser_list', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }])
    else if (last.role === 'user' && last.content === 'cancel') send(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'denied', function: { name: 'write_file', arguments: '{"path":"denied.txt","content":"no"}' } }] }, finish_reason: 'tool_calls' }] }])
    else send(res, final('Terminado.'))
  })
  const events = [], browsed = []
  const runtime = createZaiRuntime({ directory, profiles: { get: async () => ({ kind: 'compatible', baseUrl: api.url, apiKey: '' }) }, browserHub: { execute: async (...args) => { browsed.push(args); return { content: [{ type: 'text', text: 'browser connected' }] } } }, emit: (e) => events.push(e) })
  t.after(() => runtime.dispose())
  const request = { id: 'agent', cwd, connectionId: 'connection', model: 'test', text: 'start', permissions: { zaiMode: 'ask' } }
  const pending = runtime.send(request)
  while (!events.some((e) => e.type === 'approval')) await new Promise((resolve) => setTimeout(resolve, 10))
  await assert.rejects(fs.stat(path.join(cwd, 'hello.txt')), { code: 'ENOENT' })
  runtime.respond('agent', events.find((e) => e.type === 'approval').approval.requestId, { allow: true })
  await pending
  assert.equal(await fs.readFile(path.join(cwd, 'hello.txt'), 'utf8'), 'hola'); assert.equal(browsed.length, 1)
  const sessionId = events.find((e) => e.type === 'session').sessionId
  await runtime.send({ ...request, text: 'continue', sessionId })
  assert.ok(api.requests.at(-1).body.messages.some((m) => m.tool_call_id === 'write'))
  const before = events.length, cancelled = runtime.send({ ...request, text: 'cancel', sessionId })
  while (!events.slice(before).some((e) => e.type === 'approval')) await new Promise((resolve) => setTimeout(resolve, 10))
  runtime.stop('agent'); await cancelled
  await assert.rejects(fs.stat(path.join(cwd, 'denied.txt')), { code: 'ENOENT' })
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'stopped'))
})

test('fondos usan los contratos de OpenRouter, A1111 y ComfyUI sin interrupción global', async (t) => {
  const { createBackgrounds } = require('../electron/backgrounds.cjs')
  const directory = await temp(t), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR4nGP0jqr9z0ABYKJA/aiGUQ2jGkY1jGoY1QAAUqACq3K59x8AAAAASUVORK5CYII=', 'base64')
  const api = await server(t, (url, body, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (url === '/images') { assert.equal(body.model, 'image-model'); res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })) }
    else if (url === '/sdapi/v1/txt2img') { assert.equal(body.width, 1024); res.end(JSON.stringify({ images: [png.toString('base64')] })) }
    else if (url === '/prompt') { assert.equal(body.prompt['1'].inputs.text, 'a "quoted" prompt'); res.end(JSON.stringify({ prompt_id: 'my-prompt' })) }
    else if (url === '/history/my-prompt') res.end(JSON.stringify({ 'my-prompt': { outputs: { '9': { images: [{ filename: 'test.png', type: 'output' }] } }, status: { completed: true } } }))
    else if (url.startsWith('/view?')) { res.setHeader('Content-Type', 'image/png'); res.end(png) }
    else { res.writeHead(404); res.end('{}') }
  })
  let kind = 'openrouter'
  const backgrounds = createBackgrounds({ directory, profiles: { get: async () => ({ kind, baseUrl: api.url, apiKey: 'mock' }) }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 16, height: 16 }), toPNG: () => png }) } })
  for (const type of ['openrouter', 'automatic1111', 'comfyui']) {
    kind = type
    const id = await backgrounds.generate({ profileId: 'test', model: 'image-model', prompt: 'a "quoted" prompt', workflow: '{"1":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}"}}}' })
    assert.ok((await backgrounds.read(id)).equals(png))
  }
  await assert.rejects(backgrounds.read('../api-profiles.json'), /inválida/)
  assert.equal(api.requests.some((r) => r.url === '/interrupt'), false)
})

test('comandos terminan y skills de proyecto se descubren y leen como instrucciones', async (t) => {
  const { skills } = require('../electron/zai-tools.cjs')
  const cwd = await temp(t), signal = new AbortController().signal
  const output = await performTool('run_command', { command: process.platform === 'win32' ? 'echo ZAI_COMMAND_OK' : 'printf ZAI_COMMAND_OK' }, { cwd, signal })
  assert.match(output, /Exit 0/); assert.match(output, /ZAI_COMMAND_OK/)
  await fs.mkdir(path.join(cwd, '.agents/skills/review-fixture'), { recursive: true })
  await fs.writeFile(path.join(cwd, '.agents/skills/review-fixture/SKILL.md'), '---\nname: review-fixture\ndescription: Review test projects.\n---\nRead before editing.')
  const availableSkills = await skills(cwd)
  assert.ok(availableSkills.some((s) => s.name === 'review-fixture'))
  const text = await performTool('use_skill', { name: 'review-fixture' }, { cwd, signal, availableSkills })
  assert.match(text, /Read before editing/)
})

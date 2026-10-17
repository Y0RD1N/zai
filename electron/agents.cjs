const { spawn, execFile } = require('node:child_process')
const { createInterface } = require('node:readline')
const { existsSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { codexUsage, claudeRateUsage } = require('./provider-data.cjs')
const { version } = require('../package.json')

function findExecutable(name) {
  const directories = [...(process.env.PATH || '').split(path.delimiter),
    path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/pnpm'),
    path.join(os.homedir(), '.npm-global/bin'), path.join(os.homedir(), '.bun/bin'),
    path.join(os.homedir(), '.local/share/mise/shims'), path.join(os.homedir(), 'Library/pnpm'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'pnpm')] : []),
    '/opt/homebrew/bin', '/usr/local/bin']
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of directories) for (const suffix of suffixes) {
    const candidate = path.join(dir, name + suffix)
    if (existsSync(candidate)) return candidate
  }
  return null
}
function killProcess(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  else { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() } }
}
function agentEnvironment() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
function launch(command, args, cwd) {
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  return spawn(isWindowsScript ? process.env.COMSPEC || 'cmd.exe' : command,
    isWindowsScript ? ['/d', '/s', '/c', `"${command}" ${args.map((arg) => `"${arg}"`).join(' ')}`] : args,
    { cwd, env: agentEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
}

class CodexSession {
  constructor(request, emit) {
    this.request = request
    this.emit = (event) => emit({ id: request.id, ...event })
    this.pending = new Map()
    this.approvals = new Map()
    this.sequence = 0
    this.active = false
    this.closed = false
  }
  async connect() {
    const executable = findExecutable('codex')
    if (!executable) throw new Error('Codex CLI no está instalado. Instálalo y ejecuta codex login desde una terminal.')
    this.child = launch(executable, ['app-server', '--listen', 'stdio://'], this.request.cwd)
    this.child.on('error', (error) => this.fail(error))
    this.child.on('exit', () => {
      this.closed = true
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex se ha desconectado. Vuelve a enviar tu mensaje para reconectar.')) }
      this.pending.clear()
      if (this.active) this.emit({ type: 'error', message: 'El proceso de Codex terminó antes de completar la respuesta.' })
      this.active = false
    })
    this.child.stderr.on('data', () => {})
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try { this.receive(JSON.parse(line)) } catch (error) { if (!(error instanceof SyntaxError)) this.fail(error) }
    })
    await this.rpc('initialize', { clientInfo: { name: 'zai', title: 'Zai', version }, capabilities: { experimentalApi: true } })
    this.write({ method: 'initialized', params: {} })
  }
  async initialize() {
    await this.connect()
    const params = { cwd: this.request.cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write' }
    if (this.request.model) params.model = this.request.model
    const result = this.request.sessionId
      ? await this.rpc('thread/resume', { ...params, threadId: this.request.sessionId })
      : await this.rpc('thread/start', params)
    this.threadId = result.thread.id
    this.defaultModel = result.model
    this.defaultEffort = result.reasoningEffort
    this.emit({ type: 'session', sessionId: this.threadId, model: result.model })
  }
  write(frame) { if (!this.child?.stdin.destroyed) this.child.stdin.write(JSON.stringify(frame) + '\n') }
  rpc(method, params) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex no respondió a ${method}.`)) }, 45_000)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
  receive(frame) {
    if (frame.id !== undefined && !frame.method) {
      const pending = this.pending.get(frame.id)
      if (pending) { clearTimeout(pending.timer); this.pending.delete(frame.id); frame.error ? pending.reject(new Error(frame.error.message)) : pending.resolve(frame.result) }
      return
    }
    const p = frame.params || {}
    if (frame.method === 'account/rateLimits/updated') this.emit({ type: 'usage', provider: 'codex', usage: { ...codexUsage(p), partial: true } })
    if (frame.method === 'thread/tokenUsage/updated' && p.tokenUsage?.total) {
      const total = p.tokenUsage.total
      this.emit({ type: 'metrics', metrics: { inputTokens: total.inputTokens || 0, outputTokens: total.outputTokens || 0 } })
    }
    if (frame.id !== undefined && frame.method) {
      const requestId = String(frame.id)
      if (frame.method.includes('requestApproval') || frame.method.includes('requestUserInput') || frame.method.includes('elicitation/request')) {
        this.approvals.set(requestId, frame)
        this.emit({ type: 'approval', approval: {
          requestId, title: frame.method.includes('UserInput') ? 'Codex tiene una pregunta' : 'Codex solicita permiso',
          detail: p.command || p.reason || p.message || (p.grantRoot ? `Modificar archivos en ${p.grantRoot}` : JSON.stringify(p.permissions || {})),
          questions: p.questions, kind: frame.method,
        } })
        this.emit({ type: 'status', status: 'waiting' })
      } else this.write({ id: frame.id, error: { code: -32601, message: `Zai todavía no implementa ${frame.method}` } })
      return
    }
    if (frame.method === 'turn/started') {
      this.turnId = p.turn.id
      this.active = true
      this.emit({ type: 'status', status: 'running' })
    }
    if (frame.method === 'item/agentMessage/delta') this.emit({ type: 'message', messageId: p.itemId, text: p.delta, delta: true })
    if (frame.method === 'item/started' || frame.method === 'item/completed') {
      const item = p.item || {}
      if (item.type === 'agentMessage' && frame.method === 'item/completed') this.emit({ type: 'message', messageId: item.id, text: item.text || '', delta: false })
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(item.type)) {
        const detail = item.command || item.query || item.tool || item.changes?.map((c) => c.path).join(', ') || ''
        this.emit({ type: 'tool', tool: { id: item.id, name: { commandExecution: 'Terminal', fileChange: 'Archivos', mcpToolCall: 'Herramienta MCP', webSearch: 'Búsqueda web', dynamicToolCall: 'Herramienta' }[item.type], detail, status: frame.method === 'item/completed' ? item.status || 'completed' : 'running', output: item.aggregatedOutput?.slice(-12_000) } })
      }
    }
    if (frame.method === 'serverRequest/resolved') {
      this.approvals.delete(String(p.requestId))
      this.emit({ type: 'resolved', requestId: String(p.requestId) })
    }
    if (frame.method === 'turn/completed') {
      this.active = false
      for (const requestId of this.approvals.keys()) this.emit({ type: 'resolved', requestId })
      this.approvals.clear()
      if (p.turn?.status === 'interrupted') this.emit({ type: 'status', status: 'stopped' })
      else if (p.turn?.status === 'completed') this.emit({ type: 'status', status: 'idle' })
      else this.emit({ type: 'error', message: p.turn?.error?.message || 'El turno no se pudo completar.' })
    }
    if (frame.method === 'error') this.emit({ type: 'error', message: p.error?.message || p.message || 'Error de Codex' })
  }
  async send(text, selection = {}) {
    if (this.active) throw new Error('Espera a que termine el turno o detenlo primero.')
    this.active = true
    this.emit({ type: 'status', status: 'running' })
    try {
      const result = await this.rpc('turn/start', { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }],
        model: selection.model || this.defaultModel, effort: selection.effort || this.defaultEffort,
        serviceTier: selection.speed && selection.speed !== 'default' ? selection.speed : 'default' })
      this.turnId = result.turn.id
    } catch (error) { this.active = false; throw error }
  }
  async stop() {
    if (this.active && this.turnId) await this.rpc('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }
  respond(requestId, response) {
    const frame = this.approvals.get(requestId)
    if (!frame) throw new Error('La solicitud ya no está pendiente.')
    const yes = response?.allow === true
    let result
    if (frame.method.includes('requestUserInput')) result = { answers: response.answers || {} }
    else if (frame.method.includes('permissions/requestApproval')) result = { permissions: yes ? frame.params.permissions : {}, scope: 'turn' }
    else if (frame.method.includes('elicitation/request')) result = { action: 'decline', content: null }
    else result = { decision: yes ? 'accept' : 'decline' }
    this.write({ id: frame.id, result })
    this.approvals.delete(requestId)
    this.emit({ type: 'resolved', requestId })
    this.emit({ type: 'status', status: 'running' })
  }
  fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.emit({ type: 'error', message: error.message })
  }
  close() { this.active = false; this.closed = true; killProcess(this.child) }
}

class ClaudeSession {
  constructor(request, emit) {
    this.request = request
    this.sessionId = request.sessionId
    this.emit = (event) => emit({ id: request.id, ...event })
    this.approvals = new Map()
    this.active = false
    this.closed = false
  }
  async initialize() {
    if (!findExecutable('claude')) throw new Error('Claude Code no está instalado. Instálalo y ejecuta claude auth login desde una terminal.')
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    this.query = sdk.query
  }
  async send(text, selection = {}) {
    if (this.active) throw new Error('Claude ya está trabajando en este chat.')
    this.active = true
    this.emit({ type: 'status', status: 'running' })
    const abort = this.abort = new AbortController()
    this.messageId = randomUUID()
    const options = {
      cwd: this.request.cwd,
      pathToClaudeCodeExecutable: findExecutable('claude'),
      executable: findExecutable('node') || 'node',
      env: { ...agentEnvironment(), CLAUDE_AGENT_SDK_CLIENT_APP: `zai/${version}` },
      permissionMode: 'default',
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      abortController: abort,
      ...(selection.model ? { model: selection.model } : {}),
      ...(selection.effort ? { effort: selection.effort } : {}),
      settings: { fastMode: selection.speed === 'fast' },
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      canUseTool: async (name, input, context) => {
        const requestId = randomUUID()
        const detail = input.command || input.file_path || input.description || JSON.stringify(input)
        this.emit({ type: 'approval', approval: { requestId, title: `Claude quiere usar ${name}`, detail: String(detail).slice(0, 16_000), questions: name === 'AskUserQuestion' ? input.questions : undefined, kind: name } })
        this.emit({ type: 'status', status: 'waiting' })
        return new Promise((resolve) => {
          const onAbort = () => { this.approvals.delete(requestId); this.emit({ type: 'resolved', requestId }); resolve({ behavior: 'deny', message: 'Solicitud cancelada' }) }
          context.signal.addEventListener('abort', onAbort, { once: true })
          this.approvals.set(requestId, (response) => {
            context.signal.removeEventListener('abort', onAbort)
            const updatedInput = name === 'AskUserQuestion' && response.answers ? { ...input, answers: response.answers } : input
            resolve(response.allow ? { behavior: 'allow', updatedInput } : { behavior: 'deny', message: 'El usuario rechazó esta operación.' })
          })
        })
      },
    }
    // The provider owns authentication and session files; Zai never reads tokens.
    const prompt = (async function* () { yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } })()
    try { this.stream = this.query({ prompt, options }) }
    catch (error) { this.active = false; throw error }
    this.consume(this.stream, abort).catch((error) => { if (!abort.signal.aborted) this.emit({ type: 'error', message: error.message }) })
  }
  async consume(stream, abort) {
    const streamedText = new Set()
    let finished = false, finalError
    try {
      for await (const event of stream) {
        if (event.session_id && event.session_id !== this.sessionId) {
          this.sessionId = event.session_id
          this.emit({ type: 'session', sessionId: this.sessionId })
        }
        if (event.type === 'rate_limit_event') {
          const usage = claudeRateUsage(event.rate_limit_info)
          if (usage) this.emit({ type: 'usage', provider: 'claude', usage })
        }
        if (event.type === 'system' && event.subtype === 'init') this.emit({ type: 'configuration', model: event.model, effort: event.effort, speed: event.fast_mode_state, speedReason: event.fast_mode_disabled_reason })
        if (event.fast_mode_state && !(event.type === 'system' && event.subtype === 'init')) this.emit({ type: 'configuration', speed: event.fast_mode_state, speedReason: event.fast_mode_disabled_reason })
        if (event.type === 'stream_event') {
          const frame = event.event
          if (frame.type === 'message_start') this.messageId = frame.message.id
          if (frame.type === 'content_block_start' && frame.content_block.type === 'tool_use') {
            const block = frame.content_block
            this.emit({ type: 'tool', tool: { id: block.id, name: block.name, detail: 'Preparando argumentos…', status: 'running' } })
          }
          if (frame.type === 'content_block_delta' && frame.delta.type === 'text_delta') {
            streamedText.add(this.messageId)
            this.emit({ type: 'message', messageId: `${this.messageId}:text:${frame.index}`, text: frame.delta.text, delta: true })
          }
        }
        if (event.type === 'assistant') {
          const blocks = event.message.content || []
          for (const [index, block] of blocks.entries()) {
            if (block.type === 'text' && block.text && !streamedText.has(event.message.id)) this.emit({ type: 'message', messageId: `${event.message.id}:text:${index}`, text: block.text, delta: false })
            if (block.type === 'tool_use') {
              const input = block.input || {}
              this.emit({ type: 'tool', tool: { id: block.id, name: block.name, detail: String(input.command || input.file_path || input.description || JSON.stringify(input)).slice(0, 16_000), status: 'running' } })
            }
          }
        }
        if (event.type === 'user' && Array.isArray(event.message.content)) for (const block of event.message.content) if (block.type === 'tool_result') {
          this.emit({ type: 'tool', tool: { id: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', output: (typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '')).slice(-12_000) } })
        }
        if (event.type === 'result') {
          finished = true
          const totals = Object.values(event.modelUsage || {}).reduce((sum, value) => ({
            inputTokens: sum.inputTokens + (value.inputTokens || 0) + (value.cacheReadInputTokens || 0) + (value.cacheCreationInputTokens || 0),
            outputTokens: sum.outputTokens + (value.outputTokens || 0),
          }), { inputTokens: 0, outputTokens: 0 })
          this.emit({ type: 'metrics', metrics: { ...totals, costUsd: event.total_cost_usd } })
          if (event.is_error) finalError = event.errors?.join('\n') || event.result || 'Claude no pudo completar la respuesta.'
        }
      }
    } finally {
      this.active = false
      for (const [requestId, respond] of this.approvals) { respond({ allow: false }); this.emit({ type: 'resolved', requestId }) }
      this.approvals.clear()
      if (abort.signal.aborted) this.emit({ type: 'status', status: 'stopped' })
      else if (finished) this.emit(finalError ? { type: 'error', message: finalError } : { type: 'status', status: 'idle' })
    }
  }
  async stop() { this.abort?.abort(); this.stream?.close() }
  respond(requestId, response) {
    const respond = this.approvals.get(requestId)
    if (!respond) throw new Error('La solicitud ya no está pendiente.')
    respond(response)
    this.approvals.delete(requestId)
    this.emit({ type: 'resolved', requestId })
    this.emit({ type: 'status', status: 'running' })
  }
  close() { this.closed = true; this.stop() }
}

function createAgentManager(emit) {
  const sessions = new Map()
  const initializing = new Map()
  return {
    async send(request) {
      let instance = sessions.get(request.id)
      if (instance?.active) throw new Error('Este agente ya está trabajando.')
      if (!instance || instance.closed) {
        if (initializing.has(request.id)) throw new Error('El agente se está conectando.')
        emit({ id: request.id, type: 'status', status: 'starting' })
        instance = request.provider === 'codex' ? new CodexSession(request, emit) : new ClaudeSession(request, emit)
        sessions.set(request.id, instance)
        initializing.set(request.id, true)
        try { await instance.initialize(); if (instance.closed || sessions.get(request.id) !== instance) throw new Error('Conexión cancelada.') }
        catch (error) { instance.close(); sessions.delete(request.id); emit({ id: request.id, type: 'error', message: error.message }); throw error }
        finally { initializing.delete(request.id) }
      }
      try { await instance.send(request.text, request) }
      catch (error) { emit({ id: request.id, type: 'error', message: error.message }); throw error }
    },
    stop: (id) => {
      const instance = sessions.get(id)
      if (initializing.has(id)) { instance?.close(); sessions.delete(id); emit({ id, type: 'status', status: 'stopped' }); return }
      return instance?.stop()
    },
    respond: (id, requestId, response) => sessions.get(id)?.respond(requestId, response),
    close: (id) => { sessions.get(id)?.close(); sessions.delete(id) },
    dispose: () => { for (const instance of sessions.values()) instance.close(); sessions.clear() },
  }
}
module.exports = { createAgentManager, findExecutable, CodexSession, ClaudeSession, launch, agentEnvironment }

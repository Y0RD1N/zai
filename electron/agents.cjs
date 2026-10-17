const { spawn, execFile } = require('node:child_process')
const { createInterface } = require('node:readline')
const { existsSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { codexUsage, claudeRateUsage } = require('./provider-data.cjs')
const { version } = require('../package.json')
const { permissions, codexThreadPermissions, codexTurnPermissions } = require('./permissions.cjs')
const { tools: browserTools } = require('./browser-tools.cjs')
const { codexInput, claudeContent } = require('./attachments.cjs')

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
    const params = { cwd: this.request.cwd, ...codexThreadPermissions(this.request.permissions) }
    if (this.request.browserMcp) params.config = { 'mcp_servers.zai_browser': { url: this.request.browserMcp.url, http_headers: this.request.browserMcp.headers, required: true } }
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
    if (frame.method === 'thread/tokenUsage/updated' && p.tokenUsage?.total && (!this.threadId || p.threadId === this.threadId)) {
      const total = p.tokenUsage.total
      this.emit({ type: 'metrics', metrics: { inputTokens: total.inputTokens || 0, outputTokens: total.outputTokens || 0 } })
      this.emit({ type: 'context', context: { usedTokens: p.tokenUsage.last?.totalTokens, windowTokens: p.tokenUsage.modelContextWindow || undefined, estimated: false, compacting: false, updatedAt: Date.now() } })
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
      if (item.type === 'contextCompaction') {
        this.emit({ type: 'context', context: { compacting: frame.method === 'item/started', updatedAt: Date.now() } })
        this.emit({ type: 'tool', tool: { id: item.id, name: 'Compactar contexto', status: frame.method === 'item/started' ? 'running' : 'completed', output: frame.method === 'item/completed' ? 'Codex compactó la sesión. El historial visible se conserva.' : undefined } })
      }
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
      this.emit({ type: 'context', context: { compacting: false, updatedAt: Date.now() } })
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
      const result = await this.rpc('turn/start', { threadId: this.threadId, input: codexInput(text, selection.images, selection.skills, selection.apps),
        model: selection.model || this.defaultModel, effort: selection.effort || this.defaultEffort,
        serviceTier: selection.speed && selection.speed !== 'default' ? selection.speed : 'default', ...codexTurnPermissions(selection.permissions, this.request.cwd) })
      this.turnId = result.turn.id
    } catch (error) { this.active = false; throw error }
  }
  async compact() {
    if (this.active) throw new Error('Espera a que termine el turno antes de compactar.')
    this.active = true
    this.emit({ type: 'status', status: 'running' })
    this.emit({ type: 'context', context: { compacting: true, updatedAt: Date.now() } })
    try { await this.rpc('thread/compact/start', { threadId: this.threadId }) }
    catch (error) { this.active = false; this.emit({ type: 'context', context: { compacting: false, updatedAt: Date.now() } }); throw error }
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
    const access = permissions(selection.permissions)
    const options = {
      cwd: this.request.cwd,
      pathToClaudeCodeExecutable: findExecutable('claude'),
      executable: findExecutable('node') || 'node',
      env: { ...agentEnvironment(), CLAUDE_AGENT_SDK_CLIENT_APP: `zai/${version}` },
      permissionMode: access.claudeMode,
      ...(access.claudeMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(selection.browserMcp ? { mcpServers: { zai_browser: { type: 'http', ...selection.browserMcp, timeout: 180_000, alwaysLoad: true } }, allowedTools: browserTools.map((tool) => `mcp__zai_browser__${tool.name}`) } : {}),
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
    if (selection.action === 'compact') this.emit({ type: 'context', context: { compacting: true, updatedAt: Date.now() } })
    const prompt = (async function* () { yield { type: 'user', message: { role: 'user', content: claudeContent(text, selection.images) }, parent_tool_use_id: null } })()
    try { this.stream = this.query({ prompt, options }) }
    catch (error) { this.active = false; throw error }
    this.consume(this.stream, abort).catch((error) => { if (!abort.signal.aborted) this.emit({ type: 'error', message: error.message }) })
  }
  async consume(stream, abort) {
    const streamedText = new Set()
    let finished = false, finalError, hasText = false
    try {
      for await (const event of stream) {
        if (event.type === 'conversation_reset') {
          this.sessionId = event.new_conversation_id
          this.context = undefined
          this.emit({ type: 'reset', sessionId: this.sessionId })
          hasText = false
          continue
        }
        if (event.session_id && event.session_id !== this.sessionId) {
          this.sessionId = event.session_id
          this.emit({ type: 'session', sessionId: this.sessionId })
        }
        if (event.type === 'rate_limit_event') {
          const usage = claudeRateUsage(event.rate_limit_info)
          if (usage) this.emit({ type: 'usage', provider: 'claude', usage })
        }
        if (event.type === 'system' && ['local_command_output', 'informational'].includes(event.subtype) && event.content) {
          hasText = true
          this.emit({ type: 'message', messageId: event.uuid || randomUUID(), text: event.content, delta: false })
        }
        if (event.type === 'system' && event.subtype === 'init') { this.model = event.model; this.emit({ type: 'configuration', model: event.model, effort: event.effort, speed: event.fast_mode_state, speedReason: event.fast_mode_disabled_reason }) }
        if (event.type === 'system' && event.subtype === 'compact_boundary') {
          this.context = { ...this.context, usedTokens: event.compact_metadata?.post_tokens, estimated: true, compacting: false, updatedAt: Date.now() }
          this.emit({ type: 'context', context: this.context })
          this.emit({ type: 'tool', tool: { id: event.uuid || randomUUID(), name: 'Compactar contexto', status: 'completed', output: `Claude compactó la sesión (${event.compact_metadata?.trigger === 'auto' ? 'automáticamente' : 'a petición'}). El historial visible se conserva.` } })
        }
        if (event.context_usage) { this.context = { usedTokens: event.context_usage.total_tokens, windowTokens: event.context_usage.raw_max_tokens, estimated: true, updatedAt: Date.now() }; this.emit({ type: 'context', context: this.context }) }
        if (event.fast_mode_state && !(event.type === 'system' && event.subtype === 'init')) this.emit({ type: 'configuration', speed: event.fast_mode_state, speedReason: event.fast_mode_disabled_reason })
        if (event.type === 'stream_event') {
          const frame = event.event
          if (frame.type === 'message_start') this.messageId = frame.message.id
          if (frame.type === 'content_block_start' && frame.content_block.type === 'tool_use') {
            const block = frame.content_block
            this.emit({ type: 'tool', tool: { id: block.id, name: block.name, detail: 'Preparando argumentos…', status: 'running' } })
          }
          if (frame.type === 'content_block_delta' && frame.delta.type === 'text_delta') {
            hasText = true
            streamedText.add(this.messageId)
            this.emit({ type: 'message', messageId: `${this.messageId}:text:${frame.index}`, text: frame.delta.text, delta: true })
          }
        }
        if (event.type === 'assistant') {
          if (!event.parent_tool_use_id && !event.agent_id && event.message.usage) {
            const u = event.message.usage
            this.context = { ...this.context, usedTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0), estimated: false, updatedAt: Date.now() }
            this.emit({ type: 'context', context: this.context })
          }
          const blocks = event.message.content || []
          for (const [index, block] of blocks.entries()) {
            if (block.type === 'text' && block.text && !streamedText.has(event.message.id)) { hasText = true; this.emit({ type: 'message', messageId: `${event.message.id}:text:${index}`, text: block.text, delta: false }) }
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
          if (!hasText && !event.is_error && event.result) { hasText = true; this.emit({ type: 'message', messageId: event.uuid || randomUUID(), text: event.result, delta: false }) }
          const totals = Object.values(event.modelUsage || {}).reduce((sum, value) => ({
            inputTokens: sum.inputTokens + (value.inputTokens || 0) + (value.cacheReadInputTokens || 0) + (value.cacheCreationInputTokens || 0),
            outputTokens: sum.outputTokens + (value.outputTokens || 0),
          }), { inputTokens: 0, outputTokens: 0 })
          this.emit({ type: 'metrics', metrics: { ...totals, costUsd: event.total_cost_usd } })
          const modelUsage = event.modelUsage?.[this.model] || (Object.keys(event.modelUsage || {}).length === 1 ? Object.values(event.modelUsage)[0] : undefined)
          if (modelUsage?.contextWindow) { this.context = { ...this.context, windowTokens: modelUsage.contextWindow, updatedAt: Date.now() }; this.emit({ type: 'context', context: this.context }) }
          if (typeof stream.getContextUsage === 'function') {
            let timer
            try {
              const usage = await Promise.race([stream.getContextUsage({ detail: 'summary' }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Context query timed out')), 3000) })])
              this.context = { usedTokens: usage.totalTokens, windowTokens: usage.rawMaxTokens || usage.maxTokens, estimated: true, compacting: false, updatedAt: Date.now() }
              this.emit({ type: 'context', context: this.context })
            } catch { /* Older CLIs can still report per-response token usage above. */ } finally { clearTimeout(timer) }
          }
          if (event.is_error) finalError = event.errors?.join('\n') || event.result || 'Claude no pudo completar la respuesta.'
        }
      }
    } finally {
      this.active = false
      this.emit({ type: 'context', context: { compacting: false, updatedAt: Date.now() } })
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
      if (request.action === 'compact' && !request.sessionId) throw new Error('Inicia una conversación antes de compactar.')
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
      try { if (request.action === 'compact' && request.provider === 'codex') await instance.compact(); else await instance.send(request.action === 'compact' ? '/compact' : request.text, request) }
      catch (error) { emit({ id: request.id, type: 'error', message: error.message }); throw error }
    },
    stop: (id) => {
      const instance = sessions.get(id)
      if (initializing.has(id)) { instance?.close(); sessions.delete(id); emit({ id, type: 'status', status: 'stopped' }); return }
      return instance?.stop()
    },
    active: (id) => initializing.has(id) || sessions.get(id)?.active === true,
    respond: (id, requestId, response) => sessions.get(id)?.respond(requestId, response),
    close: (id) => { sessions.get(id)?.close(); sessions.delete(id) },
    dispose: () => { for (const instance of sessions.values()) instance.close(); sessions.clear() },
  }
}
module.exports = { createAgentManager, findExecutable, CodexSession, ClaudeSession, launch, agentEnvironment }

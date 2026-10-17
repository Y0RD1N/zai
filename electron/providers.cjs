const os = require('node:os')
const { CodexSession, findExecutable, agentEnvironment } = require('./agents.cjs')
const { codexModels, claudeModels, codexUsage, claudeUsage } = require('./provider-data.cjs')
const { version } = require('../package.json')

const deadline = (promise, label, duration = 18_000) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`No se pudo consultar ${label}. Inténtalo de nuevo.`)), duration) })]).finally(() => clearTimeout(timer))
}
function createProviderCatalog(emit) {
  const cache = new Map(), pending = new Map(), probes = new Set()
  let disposed = false
  async function probeCodex() {
    const session = new CodexSession({ id: 'catalog', cwd: os.homedir() }, () => {})
    probes.add(session)
    try {
      await deadline(session.connect(), 'Codex')
      const [listed, config, usage] = await Promise.all([
        deadline((async () => {
          const rows = []; let cursor
          do {
            const result = await session.rpc('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) })
            rows.push(...result.data); cursor = result.nextCursor
          } while (cursor && rows.length < 500)
          return rows
        })(), 'los modelos de Codex'),
        deadline(session.rpc('config/read', { includeLayers: false }), 'la configuración de Codex').catch(() => null),
        deadline(session.rpc('account/rateLimits/read', {}), 'el uso de Codex').then(codexUsage).catch(() => ({ windows: [], updatedAt: Date.now(), note: 'Codex no ha podido informar los límites de esta cuenta. Puedes actualizar para reintentar.' })),
      ])
      return { models: codexModels(listed), defaults: { model: config?.config.model || listed.find((row) => row.isDefault)?.model || '', effort: config?.config.model_reasoning_effort || '' }, usage }
    } finally { session.close(); probes.delete(session) }
  }
  async function probeClaude() {
    if (!findExecutable('claude')) throw new Error('Claude Code no está instalado.')
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    let release
    const wait = new Promise((resolve) => { release = resolve })
    const prompt = (async function* () { await wait })()
    const stream = query({ prompt, options: { cwd: os.homedir(), pathToClaudeCodeExecutable: findExecutable('claude'), executable: findExecutable('node') || 'node',
      env: { ...agentEnvironment(), CLAUDE_AGENT_SDK_CLIENT_APP: `zai/${version}` }, settingSources: ['user'], persistSession: false, tools: [], mcpServers: {} } })
    const probe = { close: () => { release(); stream.close() } }
    probes.add(probe)
    try {
      const init = await deadline(stream.initializationResult(), 'los modelos de Claude')
      let usage = { windows: [], updatedAt: Date.now(), note: 'Esta versión de Claude Code no publica límites de cuenta. Se actualizarán si el agente los informa durante la conversación.' }
      // Guard this optional SDK control method: older CLIs may not implement it.
      const readUsage = stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
      if (typeof readUsage === 'function') usage = await deadline(readUsage.call(stream, { skipBehaviors: true }), 'el uso de Claude').then(claudeUsage).catch(() => ({ ...usage, note: 'Claude no ha podido informar los límites de esta cuenta. Puedes actualizar para reintentar.' }))
      const models = claudeModels(init.models)
      return { models, defaults: { model: models.find((row) => row.isDefault)?.id || '', effort: '' }, usage }
    } finally { probe.close(); probes.delete(probe) }
  }
  return {
    async get(provider, refresh = false) {
      const previous = cache.get(provider)
      if (pending.has(provider)) return pending.get(provider)
      if (!refresh && previous && Date.now() - previous.updatedAt < 60_000) return previous
      const task = (provider === 'codex' ? probeCodex() : probeClaude()).then((data) => ({ ...data, updatedAt: Date.now() }))
        .catch((error) => ({ models: previous?.models || [], defaults: previous?.defaults || { model: '', effort: '' }, usage: previous?.usage || { windows: [], updatedAt: Date.now() }, updatedAt: Date.now(), error: error.message }))
        .then((data) => { if (!disposed) { cache.set(provider, data); emit({ provider, data }) }; return data })
        .finally(() => pending.delete(provider))
      pending.set(provider, task)
      return task
    },
    updateUsage(provider, usage) {
      const previous = cache.get(provider)
      if (!previous) return
      const windows = usage.partial ? [...previous.usage.windows.filter((window) => !usage.windows.some((next) => next.id === window.id)), ...usage.windows] : usage.windows
      const data = { ...previous, usage: { ...previous.usage, ...usage, plan: usage.plan || previous.usage.plan, windows, note: windows.length ? undefined : usage.note } }
      cache.set(provider, data); emit({ provider, data })
    },
    dispose() { disposed = true; for (const probe of probes) probe.close(); probes.clear() },
  }
}
module.exports = { createProviderCatalog }

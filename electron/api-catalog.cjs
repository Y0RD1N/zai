const { json, localOllama } = require('./api-client.cjs')
const speed = [{ id: 'default', name: 'Estándar', description: 'Velocidad habitual del proveedor.' }]
const routerSpeeds = [...speed,
  { id: 'latency', name: 'Menor latencia', description: 'OpenRouter prioriza el servidor que empieza a responder antes. El coste puede variar.' },
  { id: 'throughput', name: 'Más tokens/s', description: 'OpenRouter prioriza el servidor con mayor ritmo de generación. El coste puede variar.' },
]
const strings = (value) => Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === 'string' && v.length < 80))].slice(0, 20) : []
const positive = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined
function model(id, data = {}, kind) {
  // https://api-docs.deepseek.com/api/list-models/
  // https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
  // DeepSeek and OpenRouter publish different discovery schemas. Never infer levels from a model name.
  let values = data.effort?.supported_levels ?? data.reasoning?.supported_efforts ?? data.supported_reasoning_efforts
  if (kind === 'openrouter' && data.reasoning?.supported_efforts === null) values = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  values = strings(values)
  if (kind === 'deepseek' && data.effort && values.length) values = ['none', ...values.filter((v) => v !== 'none')]
  if (kind === 'openrouter' && data.reasoning?.mandatory) values = values.filter((v) => v !== 'none')
  const defaultEffort = kind === 'openrouter' && data.reasoning?.default_enabled === false ? 'none' : data.effort?.default_level || data.reasoning?.default_effort || ''
  return {
    id, name: data.name || id, description: data.description || '',
    vision: data.architecture?.input_modalities?.includes('image') || data.input_modalities?.includes('image') || false,
    isDefault: false, defaultEffort: values.includes(defaultEffort) ? defaultEffort : '',
    efforts: values.map((id) => ({ id, description: '' })), speeds: kind === 'openrouter' ? routerSpeeds : speed,
    contextWindow: positive(data.context_window || data.context_length),
    maxOutputTokens: positive(data.max_output_tokens || data.top_provider?.max_completion_tokens),
    reasoningBudget: kind === 'openrouter' && data.reasoning?.supports_max_tokens === true,
    speedNote: kind === 'openrouter' ? 'La velocidad prioriza servidores de OpenRouter; depende de su disponibilidad.' : 'Esta API no ofrece un modo rápido independiente del modelo.',
  }
}
async function apiCatalog(p) {
  const now = Date.now(), usage = { windows: [], updatedAt: now, note: 'Consumo por petición: no hay una cuota temporal anunciada. Los tokens de esta conversación se muestran cuando el proveedor los informa.' }
  let data, warning
  try { data = await json(p, localOllama(p) ? '/api/tags' : '/models') } catch (e) { if (!p.model) throw e; data = { data: [], models: [] }; warning = 'No se pudo consultar el catálogo. Se usará el identificador de modelo configurado.' }
  const models = (localOllama(p) ? data.models || [] : data.data || []).slice(0, 6000).map((m) => model(m.id || m.model || m.name, m, p.kind)).filter((m) => typeof m.id === 'string')
  let selected = models.find((m) => m.id === p.model) || models[0]
  if (p.model && !models.some((m) => m.id === p.model)) { selected = model(p.model, {}, p.kind); models.unshift(selected) }
  if (selected) selected.isDefault = true
  if (localOllama(p) && selected) {
    try {
      const detail = await json(p, '/api/show', { model: selected.id }, undefined, 12_000)
      selected.vision = detail.capabilities?.includes('vision') || false
      const thinking = detail.thinking?.values
      const thinkingId = (v) => v === true ? 'enabled' : v === false ? 'none' : v
      if (Array.isArray(thinking)) {
        const values = strings(thinking.map(thinkingId))
        selected.efforts = values.some((v) => v !== 'none') ? values.map((id) => ({ id, description: '' })) : []
        const defaultEffort = thinkingId(detail.thinking.default)
        selected.defaultEffort = selected.efforts.some((v) => v.id === defaultEffort) ? defaultEffort : ''
      }
      selected.contextWindow = positive(detail.model_info?.[`${detail.model_info?.['general.architecture']}.context_length`])
      selected.speedNote = 'La velocidad depende del motor Ollama y del modelo. Esta conexión no ofrece una prioridad rápida seleccionable.'
      if (detail.capabilities && !detail.capabilities.includes('tools')) selected.description += ' Este modelo no anuncia herramientas; úsalo para conversar.'
    } catch { /* Some cloud models do not expose /show. Keep capabilities unknown. */ }
    usage.note = p.kind === 'ollama-local' ? 'Motor local. No se aplica una cuota de cuenta de Zai. La capacidad depende de tu equipo y del contexto cargado en Ollama.' : 'Las cuotas y el saldo dependen de tu plan de Ollama Cloud.'
  }
  if (p.kind === 'deepseek') {
    try { const balance = await json(p, '/user/balance'); const item = balance.balance_infos?.[0]; if (item) usage.note = `Saldo informado: ${item.total_balance} ${item.currency}. No hay porcentaje temporal publicado.` } catch { /* endpoint optional */ }
  }
  if (p.kind === 'openrouter') {
    try { const d = (await json(p, '/key')).data; if (d) { usage.note = `Consumo de la clave: ${Number(d.usage || 0).toFixed(4)} USD${d.limit != null ? ` · límite ${d.limit} USD` : ''}.`; if (d.limit > 0) usage.windows.push({ id: 'key', label: 'Límite de la clave', usedPercent: Math.max(0, Math.min(100, d.usage / d.limit * 100)), resetsAt: null }) } } catch { /* usage optional */ }
  }
  if (p.kind === 'ollama-cloud') {
    try {
      const b = await json(p, '/api/balance')
      if (b.included?.balance_usd != null) { usage.note = `Saldo incluido: ${b.included.balance_usd} USD${b.purchased?.balance_usd != null ? ` · saldo comprado: ${b.purchased.balance_usd} USD` : ''}.`; if (b.included.allowance_usd > 0) usage.windows.push({ id: 'monthly', label: 'Mensual', usedPercent: Math.max(0, Math.min(100, (1 - b.included.balance_usd / b.included.allowance_usd) * 100)), resetsAt: Date.parse(b.period?.until) || null }) }
      for (const [id, label] of [['session', 'Sesión'], ['weekly', 'Semanal']]) { const v = b.included?.[id]; if (typeof v?.remaining_percent === 'number') usage.windows.push({ id, label, usedPercent: Math.max(0, Math.min(100, 100 - v.remaining_percent)), resetsAt: Date.parse(v.resets_at) || null }) }
    } catch { /* older/unsupported plans don't expose balance */ }
  }
  return { models, error: warning, defaults: { model: selected?.id || p.model || '', effort: selected?.defaultEffort || '' }, usage, updatedAt: now }
}
function resolveAPISelection(catalog, request) {
  const selected = catalog.models.find((m) => m.id === (request.model || catalog.defaults.model))
  if (request.effort && !selected?.efforts.some((v) => v.id === request.effort)) throw new Error('El modelo elegido no admite ese nivel de esfuerzo. Actualiza el catálogo o elige Auto.')
  if (request.speed && request.speed !== 'default' && !selected?.speeds.some((v) => v.id === request.speed)) throw new Error('Esta conexión no admite esa preferencia de velocidad.')
  const input = request.generation ?? {}, generation = {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Opciones de generación inválidas.')
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (!['maxOutputTokens', 'reasoningBudget'].includes(key) || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error('Los límites de tokens deben ser enteros entre 1 y 1.000.000.')
    generation[key] = value
  }
  if (generation.maxOutputTokens && selected?.maxOutputTokens && generation.maxOutputTokens > selected.maxOutputTokens) throw new Error(`Este modelo admite como máximo ${selected.maxOutputTokens} tokens de salida.`)
  if (generation.reasoningBudget && !selected?.reasoningBudget) throw new Error('El modelo no admite un presupuesto de tokens de razonamiento.')
  if (generation.reasoningBudget && request.effort) throw new Error('Elige esfuerzo o presupuesto de razonamiento, uno a la vez.')
  if (generation.reasoningBudget && !generation.maxOutputTokens) throw new Error('Define un límite de salida mayor que el presupuesto de razonamiento.')
  if (generation.reasoningBudget && generation.reasoningBudget >= (generation.maxOutputTokens || selected?.maxOutputTokens || Infinity)) throw new Error('El límite de salida debe ser mayor que el presupuesto de razonamiento.')
  return { model: request.model || catalog.defaults.model, effort: request.effort || undefined, speed: request.speed || 'default', generation }
}
module.exports = { apiCatalog, resolveAPISelection }

const { json, localOllama } = require('./api-client.cjs')
const speed = [{ id: 'default', name: 'Estándar', description: 'El proveedor no anuncia un modo de velocidad seleccionable.' }]
function model(id, data = {}) {
  const values = data.reasoning?.supported_efforts || data.supported_reasoning_efforts || []
  return { id, name: data.name || id, description: data.description || '', vision: data.architecture?.input_modalities?.includes('image') || data.input_modalities?.includes('image') || false, isDefault: false, defaultEffort: data.reasoning?.default_effort || '', efforts: values.filter((v) => typeof v === 'string').map((id) => ({ id, description: '' })), speeds: speed }
}
async function apiCatalog(p) {
  const now = Date.now(), usage = { windows: [], updatedAt: now, note: 'Consumo por petición: no hay una cuota temporal anunciada. Los tokens de esta conversación se muestran cuando el proveedor los informa.' }
  let data, warning
  try { data = await json(p, localOllama(p) ? '/api/tags' : '/models') } catch (e) { if (!p.model) throw e; data = { data: [], models: [] }; warning = 'No se pudo consultar el catálogo. Se usará el identificador de modelo configurado.' }
  const models = (localOllama(p) ? data.models || [] : data.data || []).slice(0, 6000).map((m) => model(m.id || m.model || m.name, m)).filter((m) => typeof m.id === 'string')
  let selected = models.find((m) => m.id === p.model) || models[0]
  if (p.model && !models.some((m) => m.id === p.model)) { selected = model(p.model); models.unshift(selected) }
  if (selected) selected.isDefault = true
  if (localOllama(p) && selected) {
    try {
      const detail = await json(p, '/api/show', { model: selected.id }, undefined, 12_000)
      selected.vision = detail.capabilities?.includes('vision') || false
      const thinking = detail.thinking?.values
      if (Array.isArray(thinking)) selected.efforts = thinking.map((v) => ({ id: v === true ? 'enabled' : v === false ? 'none' : String(v), description: '' }))
      else if (detail.capabilities?.includes('thinking')) selected.efforts = [{ id: 'none', description: '' }, { id: 'enabled', description: '' }]
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
module.exports = { apiCatalog }

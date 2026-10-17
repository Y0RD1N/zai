const percent = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
const timestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
function windowLabel(minutes) {
  if (minutes === 300) return '5 horas'
  if (minutes === 10080) return 'Semanal'
  if (minutes >= 40320 && minutes <= 44640) return 'Mensual'
  if (!minutes) return 'Uso de la cuenta'
  return minutes % 1440 === 0 ? `${minutes / 1440} días` : minutes % 60 === 0 ? `${minutes / 60} horas` : `${minutes} minutos`
}
function codexModels(rows = []) {
  return rows.filter((row) => !row.hidden).map((row) => ({
    id: row.model || row.id, name: row.displayName || row.model || row.id, description: row.description || '',
    isDefault: !!row.isDefault, defaultEffort: row.defaultReasoningEffort || '',
    efforts: (row.supportedReasoningEfforts || []).map((option) => ({ id: option.reasoningEffort, description: option.description || '' })),
    speeds: [{ id: 'default', name: 'Estándar', description: 'Velocidad estándar.' },
      ...(Array.isArray(row.serviceTiers) ? row.serviceTiers.filter((tier) => tier.id !== 'default').map((tier) => ({ ...tier, name: tier.id === 'priority' ? 'Rápida' : tier.name }))
        : (row.additionalSpeedTiers || []).includes('fast') ? [{ id: 'priority', name: 'Rápida', description: 'Prioriza la velocidad; puede consumir más cuota.' }] : [])],
  }))
}
function claudeModels(rows = []) {
  return rows.map((row) => ({
    id: row.value, resolvedModel: row.resolvedModel, name: row.displayName, description: row.description || '',
    isDefault: row.value === 'default', defaultEffort: '',
    efforts: row.supportsEffort ? (row.supportedEffortLevels || []).map((id) => ({ id, description: '' })) : [],
    speeds: [{ id: 'default', name: 'Estándar', description: 'Velocidad estándar.' },
      ...(row.supportsFastMode ? [{ id: 'fast', name: 'Rápida', description: 'Fast mode de Claude. Puede tener un coste mayor y requiere acceso en tu cuenta.' }] : [])],
  }))
}
function codexUsage(payload) {
  const buckets = payload.rateLimitsByLimitId && Object.keys(payload.rateLimitsByLimitId).length
    ? Object.entries(payload.rateLimitsByLimitId) : [[payload.rateLimits?.limitId || 'codex', payload.rateLimits]]
  const windows = []
  let plan
  for (const [key, bucket] of buckets) {
    if (!bucket) continue
    plan ||= bucket.planType || undefined
    for (const slot of ['primary', 'secondary']) {
      const window = bucket[slot]
      if (!window) continue
      windows.push({ id: `${key}:${slot}`, label: windowLabel(window.windowDurationMins), group: bucket.limitName || (key === 'codex' ? undefined : key),
        usedPercent: percent(window.usedPercent), resetsAt: timestamp(window.resetsAt) })
    }
    const spend = bucket.individualLimit
    if (spend && typeof spend.remainingPercent === 'number') {
      windows.push({ id: `${key}:spend`, label: 'Límite de gasto', group: bucket.limitName || key, usedPercent: percent(100 - spend.remainingPercent), resetsAt: timestamp(spend.resetsAt) })
    }
  }
  return { windows, plan, updatedAt: Date.now(), note: windows.length ? undefined : 'Esta conexión no publica límites de cuenta.' }
}
const claudeWindowNames = { five_hour: '5 horas', seven_day: 'Semanal', seven_day_oauth_apps: 'Semanal · aplicaciones', seven_day_opus: 'Semanal · Opus', seven_day_sonnet: 'Semanal · Sonnet', seven_day_overage_included: 'Semanal · incluido', overage: 'Uso adicional' }
function claudeUsage(payload) {
  const limits = payload.rate_limits || {}
  const windows = []
  for (const [key, label] of Object.entries(claudeWindowNames)) {
    const window = limits[key]
    if (window) windows.push({ id: key, label, usedPercent: percent(window.utilization), resetsAt: timestamp(window.resets_at) })
  }
  for (const [i, window] of (limits.model_scoped || []).entries()) windows.push({ id: `model:${window.display_name}:${i}`, label: `Semanal · ${window.display_name}`, usedPercent: percent(window.utilization), resetsAt: timestamp(window.resets_at) })
  if (limits.extra_usage?.is_enabled) {
    const extra = limits.extra_usage
    windows.push({ id: 'monthly_extra', label: 'Mensual · uso adicional', usedPercent: percent(extra.utilization), resetsAt: null })
  }
  return { windows, plan: payload.subscription_type || undefined, updatedAt: Date.now(),
    note: windows.length ? undefined : 'Esta conexión no publica límites de cuenta. El consumo de la conversación aparece al responder.' }
}
function claudeRateUsage(info) {
  if (!info.rateLimitType) return null
  return { windows: [{ id: info.rateLimitType, label: claudeWindowNames[info.rateLimitType] || info.rateLimitType,
    usedPercent: typeof info.utilization === 'number' ? percent(info.utilization * 100) : null,
    resetsAt: timestamp(info.resetsAt), status: info.status }], updatedAt: Date.now(), partial: true }
}
function resolveSelection(catalog, selection) {
  const model = catalog.models.find((row) => row.id === selection.model || row.resolvedModel === selection.model)
    || (!selection.model ? catalog.models.find((row) => row.id === catalog.defaults.model || row.isDefault) : undefined)
  if (selection.effort && model && !model.efforts.some((option) => option.id === selection.effort)) throw new Error('El modelo elegido no admite ese nivel de esfuerzo.')
  if (selection.speed && selection.speed !== 'default' && (!model || !model.speeds.some((option) => option.id === selection.speed))) throw new Error('El modelo elegido no anuncia esa velocidad. Actualiza el catálogo o usa la velocidad estándar.')
  return { model: selection.model || catalog.defaults.model || undefined,
    effort: selection.effort || (!selection.model ? catalog.defaults.effort : '') || model?.defaultEffort || undefined,
    speed: selection.speed || 'default' }
}
module.exports = { codexModels, claudeModels, codexUsage, claudeUsage, claudeRateUsage, resolveSelection }

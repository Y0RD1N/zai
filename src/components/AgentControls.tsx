import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, Gauge, LoaderCircle, RefreshCw, X, Zap } from 'lucide-react'
import type { AgentRuntime, Panel, ProviderCatalog } from '../types'

const efforts: Record<string, string> = { none: 'Sin razonamiento', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' }
const effortName = (value: string) => efforts[value] || value
export function usageSummary(catalog?: ProviderCatalog) {
  const window = catalog?.usage.windows[0]
  return window ? `${window.label} · ${window.usedPercent === null ? 'sin porcentaje' : `${Math.round(window.usedPercent)}% usado`}` : 'Uso de la cuenta'
}
function resetLabel(value: number | null) {
  if (!value) return 'Reinicio no informado'
  const date = new Date(value)
  return `Reinicia ${date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}
export function AgentControls({ panel, catalog, loading, runtime, busy, open, setOpen, section, setSection, refresh, patch }: {
  panel: Panel; catalog?: ProviderCatalog; loading: boolean; runtime: AgentRuntime; busy: boolean
  open: boolean; setOpen: (value: boolean) => void; section: 'model' | 'usage'; setSection: (value: 'model' | 'usage') => void; refresh: () => void; patch: (value: Partial<Panel>) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [custom, setCustom] = useState(false)
  const models = catalog?.models || []
  const selected = models.find((model) => model.id === panel.model || model.resolvedModel === panel.model)
  const effective = selected || (!panel.model ? models.find((model) => model.id === catalog?.defaults.model) || models.find((model) => model.isDefault) : undefined)
  const currentEffort = panel.effort || (!panel.model ? catalog?.defaults.effort : '') || effective?.defaultEffort
  const speed = effective?.speeds.find((option) => option.id === panel.speed)
  const manual = custom || !!(panel.model && !selected)
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!container.current?.contains(target) && !target.closest('.agent-option-trigger')) setOpen(false)
    }
    document.addEventListener('keydown', escape, true)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside) }
  }, [open, setOpen])
  const changeModel = (value: string) => {
    if (value === '__custom__') { setCustom(true); return }
    setCustom(false)
    const next = models.find((model) => model.id === value)
    patch({ model: value, effort: next?.efforts.some((option) => option.id === panel.effort) ? panel.effort : '',
      speed: next?.speeds.some((option) => option.id === panel.speed) ? panel.speed : 'default' })
  }
  return <>
    <button ref={trigger} className="model-button agent-option-trigger" aria-label={`Configurar modelo de ${panel.title}`} aria-expanded={open} onClick={() => { setSection('model'); setOpen(section !== 'model' || !open) }} title={effective?.name || panel.model || 'Modelo predeterminado'}><span>{effective?.name || panel.model || 'Modelo'}</span><ChevronDown size={10} /></button>
    <button className="agent-option-trigger effort-button" aria-label={`Configurar esfuerzo de ${panel.title}`} onClick={() => { setSection('model'); setOpen(section !== 'model' || !open) }} title={`Esfuerzo: ${currentEffort ? effortName(currentEffort) : 'predeterminado'}`}><Brain size={12} /><span>{panel.effort ? effortName(panel.effort) : 'Auto'}</span></button>
    <button className={`agent-option-trigger speed-button ${panel.speed !== 'default' ? 'fast' : ''}`} aria-label={`Configurar velocidad de ${panel.title}`} onClick={() => { setSection('model'); setOpen(section !== 'model' || !open) }} title={`Velocidad: ${speed?.name || 'estándar'}`}><Zap size={12} /><span>{speed?.name || 'Estándar'}</span></button>
    {open && <div ref={container} className="agent-options" role="region" aria-label={`Configuración de ${panel.title}`}>
      <div className="agent-options-heading"><div className="agent-options-tabs"><button className={section === 'model' ? 'active' : ''} onClick={() => setSection('model')}>Modelo</button><button className={section === 'usage' ? 'active' : ''} onClick={() => setSection('usage')}>Uso</button></div><button className="icon-button" disabled={loading} title="Actualizar modelos y uso" aria-label={`Actualizar modelos y uso de ${panel.title}`} onClick={refresh}>{loading ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}</button><button className="icon-button" onClick={() => setOpen(false)} aria-label={`Cerrar configuración de ${panel.title}`}><X size={13} /></button></div>
      {catalog?.error && <p className="provider-note provider-error" role="status">{catalog.error}</p>}
      {!window.zai && <p className="provider-note">Abre la app de escritorio para consultar tus modelos y límites.</p>}
      {loading && !catalog && <p className="provider-note" role="status">Consultando al agente…</p>}
      {section === 'model' && <><label className="agent-field">Modelo<select aria-label={`Modelo de ${panel.title}`} disabled={busy || loading} value={manual ? '__custom__' : selected?.id === 'default' ? '' : selected?.id || ''} onChange={(event) => changeModel(event.target.value)}>
        <option value="">Predeterminado del agente{catalog?.defaults.model ? ` · ${models.find((model) => model.id === catalog.defaults.model)?.name || catalog.defaults.model}` : ''}</option>
        {models.filter((model) => model.id !== 'default').map((model) => <option key={model.id} value={model.id}>{model.name}{model.resolvedModel && model.resolvedModel !== model.id ? ` · ${model.id}` : ''}</option>)}
        <option value="__custom__">Otro modelo…</option>
      </select></label>
      {manual && <label className="agent-field">Identificador personalizado<input aria-label={`Identificador de modelo de ${panel.title}`} disabled={busy} placeholder="ID del modelo en tu proveedor" value={panel.model} onChange={(event) => patch({ model: event.target.value, effort: '', speed: 'default' })} /></label>}
      {effective?.description && <p className="provider-note model-description">{effective.description}</p>}
      <div className="agent-field-pair"><label className="agent-field">Esfuerzo<select aria-label={`Esfuerzo de ${panel.title}`} value={panel.effort} disabled={busy || !effective?.efforts.length && !panel.effort} onChange={(event) => patch({ effort: event.target.value })}>
        <option value="">{currentEffort ? `Auto · ${effortName(currentEffort)}` : 'Predeterminado'}</option>
        {panel.effort && !effective?.efforts.some((option) => option.id === panel.effort) && <option value={panel.effort}>{effortName(panel.effort)} · no disponible</option>}
        {effective?.efforts.map((option) => <option key={option.id} value={option.id}>{effortName(option.id)}</option>)}
      </select></label><label className="agent-field">Velocidad<select aria-label={`Velocidad de ${panel.title}`} value={panel.speed} disabled={busy || (!effective || effective.speeds.length < 2) && panel.speed === 'default'} onChange={(event) => patch({ speed: event.target.value })}>
        {panel.speed !== 'default' && !effective?.speeds.some((option) => option.id === panel.speed) && <option value={panel.speed}>{panel.speed} · no disponible</option>}
        {(effective?.speeds || [{ id: 'default', name: 'Estándar' }]).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label></div>
      {!effective?.efforts.length && <p className="provider-note">El modelo no anuncia opciones de esfuerzo.</p>}
      {effective && effective.speeds.length < 2 && <p className="provider-note">Este modelo no anuncia un modo rápido en tu conexión.</p>}
      {panel.speed !== 'default' && <p className="provider-note speed-notice">{speed?.description || 'La velocidad elegida requiere acceso en tu cuenta.'} Puede aumentar el coste o el consumo de cuota.</p>}
      {runtime.configuration?.speed === 'cooldown' && <p className="provider-note speed-notice">Claude está usando velocidad estándar mientras se recupera el límite del modo rápido.</p>}
      {panel.speed === 'fast' && runtime.configuration?.speed === 'off' && <p className="provider-note speed-notice">Claude informó velocidad estándar para el último turno{runtime.configuration.speedReason ? ` (${runtime.configuration.speedReason})` : ''}.</p>}
      {busy && <p className="provider-note">Podrás cambiar las opciones cuando termine el turno.</p>}
      </>}
      {section === 'usage' && <><div className="account-usage-heading"><Gauge size={13} /><span>Uso de la cuenta</span>{catalog?.usage.plan && <small>{catalog.usage.plan}</small>}</div>
      {catalog?.usage.windows.map((window) => <div className="quota-window" key={window.id}><div><span>{window.label}{window.group && <small> · {window.group}</small>}</span><strong>{window.usedPercent === null ? 'Sin porcentaje' : `${Math.round(window.usedPercent)}% usado`}</strong></div>
        {window.usedPercent !== null && <div className={`quota-track ${window.usedPercent >= 90 ? 'quota-critical' : window.usedPercent >= 75 ? 'quota-warning' : ''}`} role="progressbar" aria-label={`${window.label} de ${panel.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent}><i style={{ width: `${window.usedPercent}%` }} /></div>}
        <small>{resetLabel(window.resetsAt)}{window.status === 'rejected' ? ' · Límite alcanzado' : ''}</small>
      </div>)}
      {catalog?.usage.note && <p className="provider-note">{catalog.usage.note}</p>}
      {runtime.metrics && <div className="conversation-usage"><span>Esta conversación</span><strong>{(runtime.metrics.inputTokens + runtime.metrics.outputTokens).toLocaleString('es')} tokens</strong>{typeof runtime.metrics.costUsd === 'number' && <small>Coste estimado: {runtime.metrics.costUsd.toLocaleString('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })}</small>}</div>}
      {catalog && <p className="usage-updated">Consultado {new Date(catalog.usage.updatedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · actualización automática</p>}</>}
    </div>}
  </>
}

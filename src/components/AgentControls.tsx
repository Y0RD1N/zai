import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, Gauge, LoaderCircle, RefreshCw, ShieldCheck, X, Zap } from 'lucide-react'
import type { AgentRuntime, Panel, ProviderCatalog } from '../types'
import { PermissionsSettings } from './PermissionsSettings'
import { AgentSelect } from './AgentSelect'
import { permissionLabel } from '../permissions'

const efforts: Record<string, string> = { none: 'Sin razonamiento', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' }
const effortName = (value: string) => efforts[value] || value
const effortDescriptions: Record<string, string> = {
  none: 'Respuesta directa, sin razonamiento adicional.', minimal: 'Un razonamiento breve para tareas sencillas.',
  low: 'Menos tiempo de razonamiento para tareas simples.', medium: 'Equilibrio entre profundidad y tiempo de respuesta.',
  high: 'Más análisis para tareas que requieren atención.', xhigh: 'Análisis más profundo para problemas complejos.',
  max: 'El nivel máximo anunciado por este modelo.', ultra: 'Razonamiento extendido para las tareas más exigentes.',
}
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
  open: boolean; setOpen: (value: boolean) => void; section: 'model' | 'usage' | 'permissions'; setSection: (value: 'model' | 'usage' | 'permissions') => void; refresh: () => void; patch: (value: Partial<Panel>) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [custom, setCustom] = useState(false)
  const models = catalog?.models || []
  const selected = models.find((model) => model.id === panel.model || model.resolvedModel === panel.model)
  const effective = selected || (!panel.model ? models.find((model) => model.id === catalog?.defaults.model) || models.find((model) => model.isDefault) : undefined)
  const autoEffort = (!panel.model ? catalog?.defaults.effort : '') || effective?.defaultEffort
  const currentEffort = panel.effort || autoEffort
  const speed = effective?.speeds.find((option) => option.id === panel.speed)
  const manual = custom || !!(panel.model && !selected)
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.agent-select-popover')) { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!container.current?.contains(target) && !target.closest('.agent-option-trigger, .agent-select-popover')) setOpen(false)
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
    <button className="agent-option-trigger permission-button" aria-label={`Configurar permisos de ${panel.title}`} onClick={() => { setSection('permissions'); setOpen(section !== 'permissions' || !open) }} title={`Permisos: ${permissionLabel(panel)}`}><ShieldCheck size={12} /><span>{permissionLabel(panel)}</span></button>
    {open && <div ref={container} className="agent-options" role="region" aria-label={`Configuración de ${panel.title}`}>
      <div className="agent-options-heading"><div className="agent-options-tabs"><button className={section === 'model' ? 'active' : ''} onClick={() => setSection('model')}>Modelo</button><button className={section === 'permissions' ? 'active' : ''} onClick={() => setSection('permissions')}>Permisos</button><button className={section === 'usage' ? 'active' : ''} onClick={() => setSection('usage')}>Uso</button></div><button className="icon-button" disabled={loading} title="Actualizar modelos y uso" aria-label={`Actualizar modelos y uso de ${panel.title}`} onClick={refresh}>{loading ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}</button><button className="icon-button" onClick={() => setOpen(false)} aria-label={`Cerrar configuración de ${panel.title}`}><X size={13} /></button></div>
      {catalog?.error && <p className="provider-note provider-error" role="status">{catalog.error}</p>}
      {!window.zai && <p className="provider-note">Abre la app de escritorio para consultar tus modelos y límites.</p>}
      {loading && !catalog && <p className="provider-note" role="status">Consultando al agente…</p>}
      {section === 'model' && <><div className="agent-field">Modelo<AgentSelect label={`Modelo de ${panel.title}`} disabled={busy || loading} value={manual ? '__custom__' : selected?.id === 'default' ? '' : selected?.id || ''} onChange={changeModel} searchable options={[
        { value: '', label: `Predeterminado del agente${catalog?.defaults.model ? ` · ${models.find((model) => model.id === catalog.defaults.model)?.name || catalog.defaults.model}` : ''}`, description: 'Usa el modelo configurado en tu agente local.', badge: 'Auto' },
        ...models.filter((model) => model.id !== 'default').map((model) => ({ value: model.id, label: `${model.name}${model.resolvedModel && model.resolvedModel !== model.id ? ` · ${model.id}` : ''}`, description: model.description, badge: model.isDefault ? 'Predeterminado' : undefined })),
        { value: '__custom__', label: 'Otro modelo…', description: 'Escribe el identificador de tu proveedor.' },
      ]} /></div>
      {manual && <label className="agent-field">Identificador personalizado<input aria-label={`Identificador de modelo de ${panel.title}`} disabled={busy} placeholder="ID del modelo en tu proveedor" value={panel.model} onChange={(event) => patch({ model: event.target.value, effort: '', speed: 'default' })} /></label>}
      {effective?.description && <p className="provider-note model-description">{effective.description}</p>}
      <div className="agent-field-pair"><div className="agent-field">Esfuerzo<AgentSelect label={`Esfuerzo de ${panel.title}`} value={panel.effort} disabled={busy || !effective?.efforts.length && !panel.effort} onChange={(effort) => patch({ effort })} options={[
        { value: '', label: autoEffort ? `Auto · ${effortName(autoEffort)}` : 'Predeterminado', description: 'Usa el esfuerzo predeterminado de este modelo.', badge: 'Auto' },
        ...(panel.effort && !effective?.efforts.some((option) => option.id === panel.effort) ? [{ value: panel.effort, label: `${effortName(panel.effort)} · no disponible`, disabled: true }] : []),
        ...(effective?.efforts || []).map((option) => ({ value: option.id, label: effortName(option.id), description: effortDescriptions[option.id] })),
      ]} /></div><div className="agent-field">Velocidad<AgentSelect label={`Velocidad de ${panel.title}`} value={panel.speed} disabled={busy || (!effective || effective.speeds.length < 2) && panel.speed === 'default'} onChange={(speed) => patch({ speed })} options={[
        ...(panel.speed !== 'default' && !effective?.speeds.some((option) => option.id === panel.speed) ? [{ value: panel.speed, label: `${panel.speed} · no disponible`, disabled: true }] : []),
        ...(effective?.speeds || [{ id: 'default', name: 'Estándar' }]).map((option) => ({ value: option.id, label: option.name, description: 'description' in option && typeof option.description === 'string' ? option.description : option.id === 'default' ? 'Velocidad habitual del modelo.' : 'Respuesta más rápida; puede consumir más cuota.' })),
      ]} /></div></div>
      {!effective?.efforts.length && <p className="provider-note">El modelo no anuncia opciones de esfuerzo.</p>}
      {effective && effective.speeds.length < 2 && <p className="provider-note">Este modelo no anuncia un modo rápido en tu conexión.</p>}
      {panel.speed !== 'default' && <p className="provider-note speed-notice">{speed?.description || 'La velocidad elegida requiere acceso en tu cuenta.'} Puede aumentar el coste o el consumo de cuota.</p>}
      {runtime.configuration?.speed === 'cooldown' && <p className="provider-note speed-notice">Claude está usando velocidad estándar mientras se recupera el límite del modo rápido.</p>}
      {panel.speed === 'fast' && runtime.configuration?.speed === 'off' && <p className="provider-note speed-notice">Claude informó velocidad estándar para el último turno{runtime.configuration.speedReason ? ` (${runtime.configuration.speedReason})` : ''}.</p>}
      {busy && <p className="provider-note">Podrás cambiar las opciones cuando termine el turno.</p>}
      </>}
      {section === 'permissions' && <PermissionsSettings panel={panel} busy={busy} patch={patch} />}
      {section === 'usage' && <><div className="account-usage-heading"><Gauge size={13} /><span>Uso de la cuenta</span>{catalog?.usage.plan && <small>{catalog.usage.plan}</small>}</div>
      {catalog?.usage.windows.map((window) => <div className="quota-window" key={window.id}><div><span>{window.label}{window.group && <small> · {window.group}</small>}</span><strong>{window.usedPercent === null ? 'Sin porcentaje' : `${Math.round(window.usedPercent)}% usado`}</strong></div>
        {window.usedPercent !== null && <div className={`quota-track ${window.usedPercent >= 90 ? 'quota-critical' : window.usedPercent >= 75 ? 'quota-warning' : ''}`} role="progressbar" aria-label={`${window.label} de ${panel.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent}><i style={{ width: `${window.usedPercent}%` }} /></div>}
        <small>{resetLabel(window.resetsAt)}{window.status === 'rejected' ? ' · Límite alcanzado' : ''}</small>
      </div>)}
      {catalog?.usage.note && <p className="provider-note">{catalog.usage.note}</p>}
      {runtime.metrics && <div className="conversation-usage"><span>Esta conversación</span><strong>{(runtime.metrics.inputTokens + runtime.metrics.outputTokens).toLocaleString('es')} tokens</strong>{typeof runtime.metrics.costUsd === 'number' && <small>{panel.kind === 'zai' ? 'Coste informado' : 'Coste estimado'}: {runtime.metrics.costUsd.toLocaleString('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })}</small>}</div>}
      {catalog && <p className="usage-updated">Consultado {new Date(catalog.usage.updatedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · actualización automática</p>}</>}
    </div>}
  </>
}

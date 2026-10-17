import { useEffect, useRef, useState } from 'react'
import { CircleGauge, LoaderCircle, Minimize2, X } from 'lucide-react'
import type { AgentRuntime, ChatSubmission, Panel } from '../types'
const number = (value: number) => new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(value)
export function ContextMeter({ panel, runtime, send, toast, open, setOpen }: { panel: Panel; runtime: AgentRuntime; send: (text: string, submission?: ChatSubmission) => Promise<void>; toast: (text: string) => void; open: boolean; setOpen: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [starting, setStarting] = useState(false)
  const context = panel.context
  const compacting = starting || context?.compacting
  const used = context?.usedTokens, limit = context?.windowTokens
  const percent = used !== undefined && limit ? used / limit * 100 : undefined
  const busy = ['running', 'starting', 'waiting'].includes(runtime.status)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open, setOpen])
  const compact = async () => {
    setStarting(true)
    try { await send('/compact', { action: 'compact' }) } catch (error) { toast(String(error)) } finally { setStarting(false) }
  }
  return <div className="context-meter" ref={ref}>
    <button className={`context-trigger ${percent !== undefined && percent >= 80 ? 'context-high' : ''}`} aria-label={`Ver contexto de ${panel.title}`} aria-expanded={open} title="Contexto de esta conversación" onClick={() => setOpen(!open)}>{compacting ? <LoaderCircle size={12} className="spin" /> : <CircleGauge size={12} />}<span>{compacting ? 'Compactando…' : percent !== undefined ? `${context?.estimated ? '≈ ' : ''}${Math.round(percent)}%` : 'Contexto'}</span></button>
    {open && <section className="context-popover" aria-label={`Contexto de ${panel.title}`}><div className="context-title"><CircleGauge size={15} /><strong>Contexto de la conversación</strong><button className="icon-button" aria-label="Cerrar contexto" onClick={() => setOpen(false)}><X size={13} /></button></div>
      <div className="context-numbers"><strong>{used === undefined ? 'Sin medición' : `${context?.estimated ? '≈ ' : ''}${number(used)}`}</strong><span>{limit ? ` / ${number(limit)} tokens` : ' · ventana no informada'}</span></div>
      <div className="context-track" role="progressbar" aria-label="Contexto ocupado" aria-valuenow={percent === undefined ? undefined : Math.min(100, Math.round(percent))} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, percent || 0)}%` }} /></div>
      <p>{used === undefined ? 'El agente informará el tamaño al responder. Los datos ausentes no se muestran como cero.' : context?.estimated ? 'Estimación del contexto activo. Se actualiza con el proveedor; no representa el consumo acumulado.' : 'Contexto del último intercambio informado por el proveedor; no representa el consumo acumulado.'}</p>
      <button className="context-compact" disabled={busy || compacting || !panel.sessionId || panel.messages.length < 2} onClick={() => void compact()}>{compacting ? <LoaderCircle className="spin" size={14} /> : <Minimize2 size={14} />}<span>{compacting ? 'Compactando contexto…' : 'Compactar contexto'}</span></button><small>Resume el contexto para continuar. El historial visible se conserva. Puede consumir tokens del modelo.</small>
    </section>}
  </div>
}

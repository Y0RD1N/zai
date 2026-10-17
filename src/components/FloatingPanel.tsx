import { Maximize2, Minimize2, Minus, X, Grip } from 'lucide-react'
import type { PointerEvent, ReactNode } from 'react'
import type { AgentStatus, Panel } from '../types'
import { ProviderMark } from './Brand'

export function startDrag(event: PointerEvent, move: (dx: number, dy: number) => void, end?: () => void) {
  if (event.button !== 0 && event.button !== 1) return
  event.preventDefault()
  event.stopPropagation()
  const { clientX, clientY } = event
  document.body.classList.add('dragging')
  const onMove = (e: globalThis.PointerEvent) => move(e.clientX - clientX, e.clientY - clientY)
  const onEnd = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    document.body.classList.remove('dragging')
    end?.()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd, { once: true })
  window.addEventListener('pointercancel', onEnd, { once: true })
}
const statusLabels: Record<AgentStatus, string> = { idle: 'Listo', starting: 'Conectando', running: 'Trabajando', waiting: 'Necesita tu atención', error: 'Revisar conexión', stopped: 'Detenido' }
export function FloatingPanel({ panel, zoom, focused, status, hidden, patch, focus, minimize, maximize, close, children }: {
  panel: Panel; zoom: number; focused: boolean; status?: AgentStatus; hidden?: boolean; patch: (patch: Partial<Panel>) => void
  focus: () => void; minimize: () => void; maximize: () => void; close: () => void; children: ReactNode
}) {
  return <section className={`floating-panel panel-${panel.kind} ${focused ? 'focused' : ''}`} style={{ display: hidden ? 'none' : undefined, left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: panel.z }}
    data-testid={`panel-${panel.kind}`} aria-label={`Ventana ${panel.title}`} onPointerDownCapture={focus}>
    <header className="panel-titlebar" onDoubleClick={maximize} onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button') || panel.maximized) return
      startDrag(event, (dx, dy) => patch({ x: panel.x + dx / zoom, y: panel.y + dy / zoom }))
    }}>
      <span className={`panel-brand brand-${panel.kind}`}><ProviderMark kind={panel.kind} size={19} /></span>
      <span className="panel-title">{panel.title}</span>
      {status && <span className={`panel-status status-${status}`}><i />{statusLabels[status]}</span>}
      {panel.kind === 'browser' && <span className="panel-context">PREVIEW</span>}
      <div className="panel-controls">
        <button className="icon-button" title={`Minimizar ${panel.title}`} aria-label={`Minimizar ${panel.title}`} onClick={minimize}><Minus size={15} /></button>
        <button className="icon-button" title={panel.maximized ? 'Restaurar tamaño' : 'Ampliar ventana'} aria-label={`Ampliar ${panel.title}`} onClick={maximize}>{panel.maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className="icon-button close-control" title={`Cerrar ${panel.title}`} aria-label={`Cerrar ${panel.title}`} onClick={close}><X size={15} /></button>
      </div>
    </header>
    <div className="panel-content">{children}</div>
    {!panel.maximized && <div className="resize-handle" role="separator" aria-label={`Redimensionar ${panel.title}`} onPointerDown={(event) => {
      startDrag(event, (dx, dy) => patch({ width: Math.max(panel.kind === 'note' ? 250 : 340, panel.width + dx / zoom), height: Math.max(panel.kind === 'note' ? 190 : 290, panel.height + dy / zoom) }))
    }}><Grip size={13} /></div>}
  </section>
}

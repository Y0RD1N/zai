import { Maximize2, Minimize2, Minus, X, Grip } from 'lucide-react'
import { useRef } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { AgentStatus, Panel } from '../types'
import { ProviderMark } from './Brand'

let finishDrag: (() => void) | undefined
export function startDrag(event: PointerEvent, move: (dx: number, dy: number) => void, end?: () => void) {
  if (event.button !== 0 && event.button !== 1) return
  event.preventDefault(); event.stopPropagation(); finishDrag?.()
  const { clientX, clientY } = event
  let frame = 0, pending: { x: number; y: number } | null = null
  document.body.classList.add('dragging')
  const flush = () => { frame = 0; if (pending) { const point = pending; pending = null; move(point.x - clientX, point.y - clientY) } }
  const onMove = (e: globalThis.PointerEvent) => { pending = { x: e.clientX, y: e.clientY }; if (!frame) frame = requestAnimationFrame(flush) }
  const onEnd = () => {
    if (frame) cancelAnimationFrame(frame)
    flush()
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd); window.removeEventListener('blur', onEnd)
    document.body.classList.remove('dragging'); finishDrag = undefined; end?.()
  }
  finishDrag = onEnd
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onEnd, { once: true })
  window.addEventListener('pointercancel', onEnd, { once: true }); window.addEventListener('blur', onEnd, { once: true })
}
export function previewPanel(id: string, patch: Partial<Panel>, end = false) { window.dispatchEvent(new CustomEvent('zai-panel-preview', { detail: { id, patch, end } })) }
const statusLabels: Record<AgentStatus, string> = { idle: 'Listo', starting: 'Conectando', running: 'Trabajando', waiting: 'Necesita tu atención', error: 'Revisar conexión', stopped: 'Detenido' }
export function FloatingPanel({ panel, zoom, focused, status, hidden, patch, focus, minimize, maximize, close, children }: {
  panel: Panel; zoom: number; focused: boolean; status?: AgentStatus; hidden?: boolean; patch: (patch: Partial<Panel>) => void
  focus: () => void; minimize: () => void; maximize: () => void; close: () => void; children: ReactNode
}) {
  const element = useRef<HTMLElement>(null)
  const drag = (event: PointerEvent, resizing = false) => {
    const el = element.current
    if (!el) return
    let final: Partial<Panel> | null = null
    if (!resizing) el.style.willChange = 'transform'
    startDrag(event, (dx, dy) => {
      if (resizing) {
        final = { width: Math.max(panel.kind === 'note' ? 250 : 340, panel.width + dx / zoom), height: Math.max(panel.kind === 'note' ? 190 : 290, panel.height + dy / zoom) }
        el.style.width = `${final.width}px`; el.style.height = `${final.height}px`
      } else { final = { x: panel.x + dx / zoom, y: panel.y + dy / zoom }; el.style.transform = `translate3d(${dx / zoom}px, ${dy / zoom}px, 0)` }
      previewPanel(panel.id, final)
    }, () => {
      if (final) { if (!resizing) { el.style.left = `${final.x}px`; el.style.top = `${final.y}px` } patch(final) }
      previewPanel(panel.id, final || {}, true)
      el.style.transform = ''; el.style.willChange = ''
    })
  }
  return <section ref={element} data-panel-id={panel.id} className={`floating-panel panel-${panel.kind} ${focused ? 'focused' : ''}`} style={{ display: hidden ? 'none' : undefined, left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: panel.z }}
    data-testid={`panel-${panel.kind}`} aria-label={`Ventana ${panel.title}`} onPointerDownCapture={focus}>
    <header className="panel-titlebar" onDoubleClick={maximize} onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button') || panel.maximized) return
      drag(event)
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
      drag(event, true)
    }}><Grip size={13} /></div>}
  </section>
}

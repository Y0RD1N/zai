import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Unplug } from 'lucide-react'
import type { BrowserActivity, BrowserConnection, Panel, Project } from '../types'
import { uid } from '../model'

type Side = 'left' | 'right'
type Port = { id: string; side: Side }
const anchor = (panel: Panel, side: Side) => panel.minimized ? { x: panel.iconX + (side === 'left' ? 6 : 66), y: panel.iconY + 33 }
  : { x: panel.x + (side === 'left' ? -2 : panel.width + 2), y: panel.y + 22 }
const curve = (a: { x: number; y: number }, b: { x: number; y: number }, aSide: Side, bSide: Side) => {
  const bend = Math.max(65, Math.min(260, Math.abs(b.x - a.x) * .5 + Math.abs(b.y - a.y) * .15))
  return `M ${a.x} ${a.y} C ${a.x + (aSide === 'right' ? bend : -bend)} ${a.y}, ${b.x + (bSide === 'right' ? bend : -bend)} ${b.y}, ${b.x} ${b.y}`
}
export function Connections({ project, activity, change, toast }: { project: Project; activity: Record<string, BrowserActivity>; change: (connections: BrowserConnection[]) => void; toast: (message: string) => void }) {
  const [armed, setArmed] = useState<Port | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState('')
  const svg = useRef<SVGSVGElement>(null)
  const cancelDrag = useRef<(() => void) | null>(null)
  const previews = useRef(new Map<string, Partial<Panel>>())
  const latest = useRef(project)
  latest.current = project
  useEffect(() => {
    const preview = (event: Event) => {
      const { id, patch, end } = (event as CustomEvent<{ id: string; patch: Partial<Panel>; end?: boolean }>).detail
      if (end) previews.current.delete(id); else previews.current.set(id, patch)
      const current = latest.current
      const target = current.panels.find((p) => p.id === id)
      if (!target) return
      const panels = current.panels.map((p) => p.id === id ? { ...p, ...patch } : p)
      for (const side of ['left', 'right'] as Side[]) {
        const port = document.querySelector<HTMLElement>(`[data-connection-panel="${CSS.escape(id)}"][data-connection-side="${side}"]`)
        const point = anchor({ ...target, ...patch }, side)
        if (port) { port.style.left = `${point.x - 12}px`; port.style.top = `${point.y - 12}px` }
      }
      for (const edge of current.connections.filter((e) => e.agentId === id || e.browserId === id)) {
        const agent = panels.find((p) => p.id === edge.agentId), browser = panels.find((p) => p.id === edge.browserId)
        if (!agent || !browser) continue
        const a = anchor(agent, edge.agentSide), b = anchor(browser, edge.browserSide), d = curve(a, b, edge.agentSide, edge.browserSide)
        const group = svg.current?.querySelector(`[data-edge-id="${CSS.escape(edge.id)}"]`)
        group?.querySelectorAll('path').forEach((path) => path.setAttribute('d', d))
        group?.querySelectorAll('animateMotion').forEach((animation) => animation.setAttribute('path', group.classList.contains('wire-completed') ? curve(b, a, edge.browserSide, edge.agentSide) : d))
        const button = document.querySelector<HTMLElement>(`[data-remove-edge="${CSS.escape(edge.id)}"]`)
        if (button) { button.style.left = `${(a.x + b.x) / 2}px`; button.style.top = `${(a.y + b.y) / 2}px` }
      }
    }
    window.addEventListener('zai-panel-preview', preview)
    return () => window.removeEventListener('zai-panel-preview', preview)
  }, [])
  const panels = project.panels.map((p) => previews.current.has(p.id) ? { ...p, ...previews.current.get(p.id) } : p).filter((panel) => ['codex', 'claude', 'zai', 'browser'].includes(panel.kind))
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelDrag.current?.(); setArmed(null); setPointer(null); setSelected('') } }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); cancelDrag.current?.() }
  }, [])
  const connect = (a: Port, b: Port) => {
    const first = panels.find((panel) => panel.id === a.id), second = panels.find((panel) => panel.id === b.id)
    if (!first || !second || first.id === second.id) return
    if ((first.kind === 'browser') === (second.kind === 'browser')) { toast('Une un navegador con un agente del mismo proyecto.'); return }
    const agent = first.kind === 'browser' ? second : first, browser = first.kind === 'browser' ? first : second
    if (project.connections.some((edge) => edge.agentId === agent.id && edge.browserId === browser.id)) { toast('Estas ventanas ya están conectadas.'); setArmed(null); return }
    change([...project.connections, { id: uid(), agentId: agent.id, browserId: browser.id, agentSide: first.id === agent.id ? a.side : b.side, browserSide: first.id === browser.id ? a.side : b.side }])
    setArmed(null); setPointer(null); toast(`${agent.title} conectado al navegador. Sus acciones viajarán por este hilo.`)
  }
  const start = (event: PointerEvent, port: Port) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    if (armed && armed.id !== port.id) { connect(armed, port); return }
    setArmed(port); setSelected('')
    let moved = false
    const move = (event: globalThis.PointerEvent) => {
      if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) < 4 && !moved) return
      moved = true; document.body.classList.add('connecting')
      const rect = svg.current?.getBoundingClientRect()
      if (rect) setPointer({ x: (event.clientX - rect.left) / project.zoom, y: (event.clientY - rect.top) / project.zoom })
    }
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); document.body.classList.remove('connecting'); cancelDrag.current = null }
    const cancel = () => { cleanup(); setArmed(null); setPointer(null) }
    const end = (event: globalThis.PointerEvent) => {
      cleanup(); setPointer(null)
      if (!moved) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-connection-panel]')
      if (target?.dataset.connectionPanel && target.dataset.connectionSide) connect(port, { id: target.dataset.connectionPanel, side: target.dataset.connectionSide as Side })
      else { setArmed(null); toast('Suelta el hilo en un punto de un agente o del navegador.') }
    }
    const startX = event.clientX, startY = event.clientY
    cancelDrag.current?.(); cancelDrag.current = cancel
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true }); window.addEventListener('pointercancel', cancel, { once: true })
  }
  const source = armed && panels.find((panel) => panel.id === armed.id)
  return <>
    <svg className="connection-canvas" ref={svg} width="1" height="1" aria-label="Conexiones del proyecto">
      {project.connections.map((edge) => {
        const agent = panels.find((panel) => panel.id === edge.agentId), browser = panels.find((panel) => panel.id === edge.browserId)
        if (!agent || !browser) return null
        const a = anchor(agent, edge.agentSide), b = anchor(browser, edge.browserSide), d = curve(a, b, edge.agentSide, edge.browserSide)
        const event = activity[`${agent.id}:${browser.id}`]
        return <g key={edge.id} className={`connection-wire brand-${agent.kind} ${selected === edge.id ? 'selected' : ''} ${event ? `wire-${event.phase}` : ''}`} data-edge-id={edge.id} data-testid="browser-connection" data-agent-id={agent.id} data-browser-id={browser.id}>
          <path className="connection-shadow" d={d} /><path className="connection-stroke" d={d} />
          <path className="connection-hit connection-control" d={d} role="button" tabIndex={0} aria-label={`Conexión ${agent.title} con ${browser.title}`} onClick={() => setSelected(selected === edge.id ? '' : edge.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(edge.id) } if (e.key === 'Delete' || e.key === 'Backspace') change(project.connections.filter((item) => item.id !== edge.id)) }}><title>{event ? `${event.action} · ${event.phase === 'started' ? 'En curso' : event.phase === 'completed' ? 'Respuesta recibida' : 'Error'}` : `${agent.title} conectado con ${browser.title}`}</title></path>
          {event && event.phase !== 'error' && <g key={event.operationId + event.phase} className="connection-pulses" aria-label={event.phase === 'started' ? 'Acción enviada al navegador' : 'Respuesta del navegador'}>{[0, .28].map((delay) => <circle key={delay} r="3" className="connection-pulse"><animateMotion dur="1s" begin={`${delay}s`} repeatCount={event.phase === 'started' ? 'indefinite' : '1'} fill="remove" path={event.phase === 'completed' ? curve(b, a, edge.browserSide, edge.agentSide) : d} /><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.05;.9;1" dur="1s" begin={`${delay}s`} repeatCount={event.phase === 'started' ? 'indefinite' : '1'} fill="remove" /></circle>)}</g>}
        </g>
      })}
      {source && pointer && armed && <path className="connection-draft" d={curve(anchor(source, armed.side), pointer, armed.side, armed.side === 'left' ? 'right' : 'left')} />}
    </svg>
    {panels.flatMap((panel) => (['left', 'right'] as Side[]).map((side) => {
      const point = anchor(panel, side), linked = project.connections.some((edge) => edge.agentId === panel.id || edge.browserId === panel.id)
      return <button key={`${panel.id}:${side}`} className={`connection-port connection-control brand-${panel.kind} ${linked ? 'linked' : ''} ${armed?.id === panel.id ? 'armed' : ''} ${armed && armed.id !== panel.id ? 'possible-target' : ''}`} style={{ left: point.x - 12, top: point.y - 12, zIndex: panel.z + .2 } as CSSProperties}
        data-connection-panel={panel.id} data-connection-side={side} aria-label={`Conectar ${panel.title} · lado ${side === 'left' ? 'izquierdo' : 'derecho'}`} aria-pressed={armed?.id === panel.id && armed.side === side} title="Arrastra hasta el punto de otra ventana para conectarlas" onPointerDown={(event) => start(event, { id: panel.id, side })} onClick={(event) => { if (event.detail === 0) { if (armed) connect(armed, { id: panel.id, side }); else setArmed({ id: panel.id, side }) } }}><i /></button>
    }))}
    {project.connections.filter((edge) => edge.id === selected).map((edge) => {
      const agent = panels.find((panel) => panel.id === edge.agentId), browser = panels.find((panel) => panel.id === edge.browserId)
      if (!agent || !browser) return null
      const a = anchor(agent, edge.agentSide), b = anchor(browser, edge.browserSide)
      return <button key={edge.id} data-remove-edge={edge.id} disabled={activity[`${edge.agentId}:${edge.browserId}`]?.phase === 'started'} title={activity[`${edge.agentId}:${edge.browserId}`]?.phase === 'started' ? 'El navegador está trabajando' : 'Desconectar navegador'} className="connection-remove connection-control" style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }} aria-label={`Desconectar ${agent.title} de ${browser.title}`} onClick={() => { change(project.connections.filter((item) => item.id !== edge.id)); setSelected('') }}><Unplug size={13} />Desconectar</button>
    })}
  </>
}

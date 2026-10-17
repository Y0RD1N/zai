import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Activity as ActivityIcon, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Command, Download, Folder, FolderOpen, GripHorizontal, Hand, Keyboard, LayoutGrid, LoaderCircle, Maximize2, Minus, Moon, MoreHorizontal, MousePointer2, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Plus, Search, Settings2, Sparkles, Sun, Trash2, X } from 'lucide-react'
import { AgentChat } from './components/AgentChat'
import { BrowserPanel } from './components/BrowserPanel'
import { FloatingPanel, startDrag } from './components/FloatingPanel'
import { ProviderMark, ZaiMark } from './components/Brand'
import { Connections } from './components/Connections'
import { defaultPermissions } from './permissions'
const TerminalPanel = lazy(() => import('./components/TerminalPanel').then((module) => ({ default: module.TerminalPanel })))
import { activity, clamp, colors, hydrate, initialWorkspace, makePanel, makeProject, names, uid } from './model'
import type { AgentEvent, AgentRuntime, BrowserActivity, Panel, PanelKind, Project, Provider, ProviderCatalog, ProviderInfo, Workspace } from './types'

const emptyRuntime: AgentRuntime = { status: 'idle', tools: [], approvals: [] }
const kinds: PanelKind[] = ['codex', 'claude', 'browser', 'terminal', 'note']
const descriptions: Record<PanelKind, string> = { codex: 'Tu agente para construir', claude: 'Una nueva perspectiva', browser: 'Prueba tu proyecto en vivo', terminal: 'Tus comandos, aquí mismo', note: 'Que no se escape una idea' }
function localWorkspace() { try { return hydrate(JSON.parse(localStorage.getItem('zai.workspace.v1') || 'null')) || initialWorkspace() } catch { return initialWorkspace() } }
function readableError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '') }

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(localWorkspace)
  const state = useRef(workspace)
  state.current = workspace
  const [ready, setReady] = useState(!window.zai)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved')
  const [runtime, setRuntime] = useState<Record<string, AgentRuntime>>({})
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const [focused, setFocused] = useState('')
  const [tool, setTool] = useState<'pointer' | 'hand'>('pointer')
  const [modal, setModal] = useState<'settings' | 'help' | 'project' | 'palette' | null>(null)
  const [projectEdit, setProjectEdit] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState({ name: '', color: colors[0], folder: '' })
  const [activityOpen, setActivityOpen] = useState(false)
  const [launcher, setLauncher] = useState(false)
  const [search, setSearch] = useState('')
  const [paletteQuery, setPaletteQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [providers, setProviders] = useState<Partial<Record<Provider, ProviderInfo>>>({})
  const [catalogs, setCatalogs] = useState<Partial<Record<Provider, ProviderCatalog>>>({})
  const [catalogLoading, setCatalogLoading] = useState<Partial<Record<Provider, boolean>>>({})
  const [browserActivity, setBrowserActivity] = useState<Record<string, BrowserActivity>>({})
  const [platform, setPlatform] = useState('')
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight - 64 })
  const [renaming, setRenaming] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const minimizedTray = useRef<HTMLDetailsElement>(null)
  const space = useRef(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const project = workspace.projects.find((p) => p.id === workspace.activeProjectId) || workspace.projects[0]
  const browserGraph = JSON.stringify(workspace.projects.map((p) => ({ id: p.id, panels: p.panels.filter((panel) => ['codex', 'claude', 'browser'].includes(panel.kind)).map(({ id, kind }) => ({ id, kind })), connections: p.connections })))
  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => { if (!minimizedTray.current?.contains(event.target as Node)) minimizedTray.current?.removeAttribute('open') }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') minimizedTray.current?.removeAttribute('open') }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [])
  const toast = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 5000)
  }, [])
  const updateProject = useCallback((projectId: string, patch: Partial<Project>) => {
    setWorkspace((current) => ({ ...current, projects: current.projects.map((p) => p.id === projectId ? { ...p, ...patch } : p) }))
  }, [])
  const updatePanel = useCallback((projectId: string, panelId: string, patch: Partial<Panel>) => {
    setWorkspace((current) => ({ ...current, projects: current.projects.map((p) => p.id === projectId ? { ...p, panels: p.panels.map((panel) => panel.id === panelId ? { ...panel, ...patch } : panel) } : p) }))
  }, [])
  const log = useCallback((projectId: string, text: string, kind: 'info' | 'success' | 'error' = 'info', panelId?: string) => {
    setWorkspace((current) => ({ ...current, activities: [activity(projectId, text, kind, panelId), ...current.activities].slice(0, 150) }))
  }, [])
  const refreshCatalog = useCallback(async (provider: Provider, refresh = false) => {
    if (!window.zai?.catalog) return
    setCatalogLoading((old) => ({ ...old, [provider]: true }))
    try {
      const data = await window.zai.catalog(provider, refresh)
      setCatalogs((old) => ({ ...old, [provider]: data }))
    } catch (error) { toast(readableError(error)) }
    finally { setCatalogLoading((old) => ({ ...old, [provider]: false })) }
  }, [toast])
  useEffect(() => {
    if (ready) void window.zai?.syncBrowserGraph?.(JSON.parse(browserGraph)).catch((error) => toast(readableError(error)))
  }, [browserGraph, ready, toast])
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const navigate = window.zai?.onBrowserNavigate?.(({ browserId, url }) => {
      const owner = state.current.projects.find((p) => p.panels.some((panel) => panel.id === browserId && panel.kind === 'browser'))
      if (owner) updatePanel(owner.id, browserId, { url })
    })
    const activity = window.zai?.onBrowserActivity?.((event) => {
      const key = `${event.agentId}:${event.browserId}`
      const previous = timers.get(key); if (previous) clearTimeout(previous)
      setBrowserActivity((old) => ({ ...old, [key]: event }))
      if (event.phase !== 'started') timers.set(key, setTimeout(() => setBrowserActivity((old) => { if (old[key]?.operationId !== event.operationId) return old; const next = { ...old }; delete next[key]; return next }), 1400))
      const owner = state.current.projects.find((p) => p.panels.some((panel) => panel.id === event.agentId))
      const agent = owner?.panels.find((panel) => panel.id === event.agentId)
      if (owner && agent && event.phase !== 'completed') log(owner.id, `${agent.title} → Navegador · ${event.action}${event.error ? `: ${event.error}` : ''}`, event.phase === 'error' ? 'error' : 'info', agent.id)
    })
    return () => { navigate?.(); activity?.(); for (const timer of timers.values()) clearTimeout(timer) }
  }, [updatePanel, log])
  useEffect(() => {
    if (!ready || !window.zai?.catalog) return
    const unsubscribe = window.zai.onProvider?.(({ provider, data }) => setCatalogs((old) => ({ ...old, [provider]: data })))
    for (const provider of ['codex', 'claude'] as const) void refreshCatalog(provider)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') for (const provider of ['codex', 'claude'] as const) void refreshCatalog(provider, true)
    }, 120_000)
    return () => { unsubscribe?.(); clearInterval(timer) }
  }, [ready, refreshCatalog])
  useEffect(() => {
    if (!window.zai) return
    let cancelled = false
    window.zai.load().then((data) => {
      const restored = hydrate(data)
      if (!cancelled && restored) setWorkspace(restored)
    }).catch((error) => { if (!cancelled) toast(readableError(error)) }).finally(() => { if (!cancelled) setReady(true) })
    window.zai.info().then((info) => { if (!cancelled) setPlatform(info.platform) })
    window.zai.providers().then((data) => { if (!cancelled) setProviders(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [toast])
  useEffect(() => {
    if (!ready) return
    setSaved('saving')
    const timer = setTimeout(() => {
      try { localStorage.setItem('zai.workspace.v1', JSON.stringify(workspace)) } catch { if (!window.zai) { setSaved('error'); return } }
      if (window.zai) window.zai.save(workspace).then(() => setSaved('saved')).catch((e) => { setSaved('error'); toast(readableError(e)) })
      else setSaved('saved')
    }, 400)
    return () => clearTimeout(timer)
  }, [workspace, ready, toast])
  useEffect(() => { document.documentElement.dataset.theme = workspace.theme; document.documentElement.style.setProperty('--accent', workspace.accent) }, [workspace.theme, workspace.accent])
  useEffect(() => window.zai?.onClosing?.(() => {
    void window.zai!.save(state.current).then(() => window.zai!.finishClose()).catch((error) => toast(readableError(error)))
  }), [toast])
  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => window.zai?.onAgent((event: AgentEvent) => {
    const current = state.current
    const owner = current.projects.find((p) => p.panels.some((panel) => panel.id === event.id))
    const panel = owner?.panels.find((p) => p.id === event.id)
    if (!owner || !panel) return
    const old = runtimeRef.current[event.id] || emptyRuntime
    let next = old
    if (event.type === 'status') {
      next = { ...old, status: event.status, error: undefined }
      if (event.status === 'idle' && old.status !== 'idle') { log(owner.id, `${panel.title} completó su turno`, 'success', panel.id); void refreshCatalog(panel.kind as Provider, true) }
      if (event.status === 'stopped') log(owner.id, `${panel.title} se detuvo`, 'info', panel.id)
    }
    if (event.type === 'error') { next = { ...old, status: 'error', error: event.message }; if (old.error !== event.message) log(owner.id, `${panel.title} · ${event.message}`, 'error', panel.id) }
    if (event.type === 'tool') {
      const existing = old.tools.find((t) => t.id === event.tool.id)
      next = { ...old, tools: existing ? old.tools.map((t) => t.id === event.tool.id ? { ...t, ...event.tool } : t) : [...old.tools, event.tool].slice(-40) }
      if (!existing) log(owner.id, `${panel.title} · ${event.tool.name || 'Herramienta'}${event.tool.detail ? `: ${event.tool.detail.slice(0, 100)}` : ''}`, 'info', panel.id)
      setWorkspace((w) => ({ ...w, projects: w.projects.map((p) => p.id !== owner.id ? p : { ...p, panels: p.panels.map((target) => {
        if (target.id !== event.id) return target
        const timeline = target.timeline || target.messages.map((message) => ({ kind: 'message' as const, id: message.id }))
        const exists = timeline.some((item) => item.kind === 'tool' && item.tool.id === event.tool.id)
        return { ...target, timeline: exists ? timeline.map((item) => item.kind === 'tool' && item.tool.id === event.tool.id ? { ...item, tool: { ...item.tool, ...event.tool } } : item) : [...timeline, { kind: 'tool' as const, tool: event.tool }] }
      }) }) }))
    }
    if (event.type === 'approval') { next = { ...old, status: 'waiting', approvals: [...old.approvals.filter((a) => a.requestId !== event.approval.requestId), event.approval] }; log(owner.id, `${panel.title} necesita tu atención`, 'info', panel.id) }
    if (event.type === 'resolved') next = { ...old, approvals: old.approvals.filter((a) => a.requestId !== event.requestId) }
    if (event.type === 'configuration') next = { ...old, configuration: { ...old.configuration, ...event } }
    if (event.type === 'metrics') next = { ...old, metrics: event.metrics }
    if (next !== old) { runtimeRef.current = { ...runtimeRef.current, [event.id]: next }; setRuntime(runtimeRef.current) }
    if (event.type === 'session') updatePanel(owner.id, panel.id, { sessionId: event.sessionId })
    if (event.type === 'message') setWorkspace((w) => ({ ...w, projects: w.projects.map((p) => p.id === owner.id ? { ...p, panels: p.panels.map((target) => {
      if (target.id !== event.id) return target
      const exists = target.messages.some((m) => m.id === event.messageId)
      const messages = exists ? target.messages.map((m) => m.id === event.messageId ? { ...m, text: event.delta ? m.text + event.text : event.text } : m) : [...target.messages, { id: event.messageId, role: 'assistant' as const, text: event.text, time: Date.now() }]
      const timeline = target.timeline || target.messages.map((message) => ({ kind: 'message' as const, id: message.id }))
      return { ...target, messages, timeline: exists ? timeline : [...timeline, { kind: 'message' as const, id: event.messageId }] }
    }) } : p) }))
  }), [log, updatePanel, refreshCatalog])

  const focusPanel = useCallback((ownerId: string, id: string) => {
    setFocused(id)
    setWorkspace((w) => {
      const owner = w.projects.find((p) => p.id === ownerId)!
      const panel = owner.panels.find((p) => p.id === id)
      const maxZ = Math.max(0, ...owner.panels.map((p) => p.z))
      if (!panel || panel.z === maxZ) return w
      return { ...w, projects: w.projects.map((p) => p.id === ownerId ? { ...p, panels: p.panels.map((item) => item.id === id ? { ...item, z: maxZ + 1 } : item) } : p) }
    })
  }, [])
  const addPanel = useCallback((kind: PanelKind) => {
    const p = state.current.projects.find((p) => p.id === state.current.activeProjectId)!
    const panel = makePanel(kind, p.panels.length)
    panel.x = Math.max(0, (size.width / 2 - p.pan.x) / p.zoom - panel.width / 2) + p.panels.length % 4 * 20
    panel.y = Math.max(0, (size.height / 2 - p.pan.y) / p.zoom - panel.height / 2) + p.panels.length % 4 * 20
    panel.z = Math.max(0, ...p.panels.map((item) => item.z)) + 1
    updateProject(p.id, { panels: [...p.panels, panel] })
    setFocused(panel.id)
    setLauncher(false)
    setModal(null)
    log(p.id, `${names[kind]} se añadió a la pizarra`, 'info', panel.id)
  }, [size, updateProject, log])
  const fitBoard = useCallback(() => {
    const p = state.current.projects.find((p) => p.id === state.current.activeProjectId)!
    const panels = p.panels.filter((panel) => !panel.minimized)
    if (!panels.length) { updateProject(p.id, { pan: { x: 305, y: 137 }, zoom: 0.9 }); return }
    const left = Math.min(...panels.map((p) => p.x)), top = Math.min(...panels.map((p) => p.y))
    const right = Math.max(...panels.map((p) => p.x + p.width)), bottom = Math.max(...panels.map((p) => p.y + p.height))
    const zoom = clamp(Math.min((size.width - 345) / (right - left), (size.height - 220) / (bottom - top), 1.1), 0.35, 1.5)
    updateProject(p.id, { zoom, pan: { x: 290 + (size.width - 330 - (right - left) * zoom) / 2 - left * zoom, y: 130 + (size.height - 220 - (bottom - top) * zoom) / 2 - top * zoom } })
  }, [size, updateProject])
  const arrange = () => {
    const visible = project.panels.filter((p) => !p.minimized)
    updateProject(project.id, { panels: project.panels.map((p) => { const i = visible.findIndex((v) => v.id === p.id); return i < 0 ? p : { ...p, x: i % 2 * 480, y: Math.floor(i / 2) * 440, width: 450, height: 410, maximized: false } }) })
    setTimeout(fitBoard, 0)
    toast('Ventanas organizadas en la pizarra.')
  }
  const zoomBy = useCallback((factor: number) => {
    const p = state.current.projects.find((p) => p.id === state.current.activeProjectId)!
    const zoom = clamp(p.zoom * factor, 0.35, 1.5)
    const center = { x: size.width * 0.6, y: size.height * 0.5 }
    updateProject(p.id, { zoom, pan: { x: center.x - (center.x - p.pan.x) * zoom / p.zoom, y: center.y - (center.y - p.pan.y) * zoom / p.zoom } })
  }, [size, updateProject])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.floating-ui, .floating-panel, .canvas-icon') && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const p = state.current.projects.find((p) => p.id === state.current.activeProjectId)!
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top
        const zoom = clamp(p.zoom * Math.exp(-e.deltaY * 0.003), 0.35, 1.5)
        updateProject(p.id, { zoom, pan: { x: x - (x - p.pan.x) * zoom / p.zoom, y: y - (y - p.pan.y) * zoom / p.zoom } })
      } else updateProject(p.id, { pan: { x: p.pan.x - e.deltaX, y: p.pan.y - e.deltaY } })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [updateProject])
  const newProject = useCallback(() => { setProjectEdit(null); setProjectDraft({ name: '', color: colors[state.current.projects.length % colors.length], folder: '' }); setModal('project'); setLauncher(false) }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const editable = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], .xterm, .agent-select-popover, .agent-select-trigger')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal((m) => m === 'palette' ? null : 'palette'); setPaletteQuery(''); return }
      if (e.key === 'Escape') { setModal(null); setLauncher(false); setActivityOpen(false); setRenaming(null) }
      if (editable || modal) return
      if (e.code === 'Space') { e.preventDefault(); space.current = true; document.body.classList.add('space-pan') }
      if (e.key.toLowerCase() === 'v') setTool('pointer')
      if (e.key.toLowerCase() === 'h') setTool('hand')
      if (e.key.toLowerCase() === 'f') fitBoard()
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) addPanel('note')
      if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); zoomBy(1.1) }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.1) }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; document.body.classList.remove('space-pan') } }
    const blur = () => { space.current = false; document.body.classList.remove('space-pan') }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [modal, fitBoard, addPanel, zoomBy])

  const chooseFolder = async (owner: Project) => {
    if (!window.zai) { toast('La selección de carpetas está disponible en la app de escritorio.'); return }
    try {
      const folder = await window.zai.chooseFolder()
      if (!folder || folder === owner.folder) return
      const hasSessions = owner.panels.some((p) => p.sessionId || ['running', 'starting', 'waiting'].includes(runtimeRef.current[p.id]?.status))
      if (hasSessions) { toast('Crea otro proyecto para cambiar de carpeta sin mezclar las conversaciones actuales.'); return }
      updateProject(owner.id, { folder }); log(owner.id, 'Carpeta vinculada al proyecto', 'success')
    } catch (e) { toast(readableError(e)) }
  }
  const send = async (owner: Project, panel: Panel, text: string) => {
    if (!window.zai) throw new Error('Abre Zai en modo escritorio.')
    const entry = { ...(runtimeRef.current[panel.id] || emptyRuntime), status: 'starting' as const, error: undefined, configuration: undefined, tools: [], approvals: [] }
    runtimeRef.current = { ...runtimeRef.current, [panel.id]: entry }; setRuntime(runtimeRef.current)
    const messageId = uid()
    setWorkspace((w) => ({ ...w, projects: w.projects.map((p) => p.id === owner.id ? { ...p, panels: p.panels.map((target) => target.id === panel.id ? { ...target,
      messages: [...target.messages, { id: messageId, role: 'user' as const, text, time: Date.now() }],
      timeline: [...(target.timeline || target.messages.map((message) => ({ kind: 'message' as const, id: message.id }))), { kind: 'message' as const, id: messageId }],
    } : target) } : p) }))
    log(owner.id, `${panel.title} recibió una tarea`, 'info', panel.id)
    try { await window.zai.syncBrowserGraph?.(JSON.parse(browserGraph)); await window.zai.send({ id: panel.id, provider: panel.kind as Provider, text, cwd: owner.folder, sessionId: panel.sessionId, model: panel.model || undefined, effort: panel.effort || undefined, speed: panel.speed, permissions: panel.permissions }) }
    catch (error) {
      const next = { ...entry, status: 'error' as const, error: readableError(error) }
      runtimeRef.current = { ...runtimeRef.current, [panel.id]: next }; setRuntime(runtimeRef.current)
      throw error
    }
  }
  const closePanel = (owner: Project, panel: Panel) => {
    void window.zai?.closeAgent(panel.id); void window.zai?.closeTerminal(panel.id)
    const nextRuntime = { ...runtimeRef.current }; delete nextRuntime[panel.id]
    runtimeRef.current = nextRuntime; setRuntime(nextRuntime)
    updateProject(owner.id, { panels: owner.panels.filter((p) => p.id !== panel.id), connections: owner.connections.filter((edge) => edge.agentId !== panel.id && edge.browserId !== panel.id) })
    log(owner.id, `${panel.title} se cerró`)
  }
  const maximize = (owner: Project, panel: Panel) => {
    if (panel.maximized && panel.previousBounds) updatePanel(owner.id, panel.id, { ...panel.previousBounds, maximized: false, previousBounds: undefined })
    else updatePanel(owner.id, panel.id, { previousBounds: { x: panel.x, y: panel.y, width: panel.width, height: panel.height }, maximized: true, x: (285 - owner.pan.x) / owner.zoom, y: (120 - owner.pan.y) / owner.zoom, width: Math.max(350, (size.width - 320) / owner.zoom), height: Math.max(300, (size.height - 220) / owner.zoom) })
    focusPanel(owner.id, panel.id)
  }
  const minimize = (owner: Project, panel: Panel) => {
    const i = owner.panels.filter((p) => p.minimized).length
    updatePanel(owner.id, panel.id, { minimized: true, iconX: panel.x + Math.min(120, i * 40), iconY: panel.y })
    toast(`${panel.title} sigue disponible desde su icono.`)
  }
  const saveProject = () => {
    const name = projectDraft.name.trim()
    if (!name) return
    if (projectEdit) updateProject(projectEdit, projectDraft)
    else { const p = makeProject(name, projectDraft.color); p.folder = projectDraft.folder; setWorkspace((w) => ({ ...w, projects: [...w.projects, p], activeProjectId: p.id, activities: [activity(p.id, 'Proyecto creado'), ...w.activities].slice(0, 150) })) }
    setModal(null); setFocused('')
  }
  const deleteProject = () => {
    if (!projectEdit || workspace.projects.length < 2) return
    const target = workspace.projects.find((p) => p.id === projectEdit)!
    for (const p of target.panels) { void window.zai?.closeAgent(p.id); void window.zai?.closeTerminal(p.id) }
    setWorkspace((w) => { const projects = w.projects.filter((p) => p.id !== projectEdit); return { ...w, projects, activeProjectId: w.activeProjectId === projectEdit ? projects[0].id : w.activeProjectId, activities: w.activities.filter((a) => a.projectId !== projectEdit) } })
    setModal(null); toast('Proyecto retirado de Zai. Los archivos de su carpeta se conservan.')
  }
  const editProject = (p: Project) => { setProjectEdit(p.id); setProjectDraft({ name: p.name, color: p.color, folder: p.folder }); setModal('project') }
  const switchProject = (id: string) => { setWorkspace((w) => ({ ...w, activeProjectId: id })); setFocused(''); setSearch('') }
  const dragCanvas = (e: PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.floating-ui, .project-heading, .empty-board, .connection-control, .agent-select-popover')) return
    if (e.button === 1 || tool === 'hand' || space.current) {
      startDrag(e, (dx, dy) => updateProject(project.id, { pan: { x: project.pan.x + dx, y: project.pan.y + dy } }))
      setFocused('')
    } else if (!target.closest('.floating-panel, .canvas-icon')) setFocused('')
  }
  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = `zai-pizarra-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const importWorkspace = async (file: File | undefined) => {
    if (!file) return
    try {
      if (file.size > 12_000_000) throw new Error('El archivo es demasiado grande.')
      const imported = hydrate(JSON.parse(await file.text()))
      if (!imported) throw new Error('Este archivo no es una pizarra válida de Zai.')
      const freshProjects = imported.projects.map((p) => {
        const ids = new Map(p.panels.map((panel) => [panel.id, uid()]))
        return { ...p, id: uid(), folder: '', panels: p.panels.map((panel) => ({ ...panel, id: ids.get(panel.id)!, sessionId: undefined, permissions: { ...defaultPermissions } })),
          connections: p.connections.map((edge) => ({ ...edge, id: uid(), agentId: ids.get(edge.agentId)!, browserId: ids.get(edge.browserId)! })) }
      })
      setWorkspace((w) => ({ ...w, projects: [...w.projects, ...freshProjects], activeProjectId: freshProjects[0].id }))
      setModal(null); toast('Proyectos importados. Vincula sus carpetas antes de iniciar los agentes.')
    } catch (e) { toast(readableError(e)) }
  }
  const commands = [...kinds.map((kind) => ({ id: kind, title: `Abrir ${names[kind]}`, detail: descriptions[kind], icon: <ProviderMark kind={kind} size={21} />, run: () => addPanel(kind) })),
    { id: 'project', title: 'Crear proyecto', detail: 'Un nuevo espacio para una idea', icon: <Folder size={21} />, run: newProject },
    { id: 'fit', title: 'Ver toda la pizarra', detail: 'Encuadra todas tus ventanas', icon: <Maximize2 size={20} />, run: () => { fitBoard(); setModal(null) } },
    { id: 'arrange', title: 'Organizar ventanas', detail: 'Ordenar en una cuadrícula', icon: <LayoutGrid size={20} />, run: () => { arrange(); setModal(null) } }]
  const visibleProjects = workspace.projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  const activeAgents = project.panels.filter((p) => ['running', 'starting', 'waiting'].includes(runtime[p.id]?.status)).length
  const projectActivities = workspace.activities.filter((a) => a.projectId === project.id)
  const minimizedPanels = workspace.projects.flatMap((owner) => owner.panels.filter((panel) => panel.minimized).map((panel) => ({ owner, panel })))
  const restorePanel = (owner: Project, panel: Panel) => {
    const left = workspace.sidebar.collapsed ? 120 : 290
    const width = Math.max(250, size.width - left - 28), height = Math.max(200, size.height - 180)
    const zoom = clamp(Math.min(owner.zoom, width / panel.width, height / panel.height), 0.35, 1.5)
    setWorkspace((current) => ({ ...current, activeProjectId: owner.id, projects: current.projects.map((p) => p.id !== owner.id ? p : { ...p, zoom,
      pan: { x: left + (width - panel.width * zoom) / 2 - panel.x * zoom, y: 120 + (height - panel.height * zoom) / 2 - panel.y * zoom },
      panels: p.panels.map((target) => target.id === panel.id ? { ...target, minimized: false, z: Math.max(0, ...p.panels.map((item) => item.z)) + 1 } : target) }) }))
    setFocused(panel.id)
  }
  const sidebarPosition = { left: clamp(workspace.sidebar.x, 10, Math.max(10, size.width - (workspace.sidebar.collapsed ? 82 : 250))), top: clamp(workspace.sidebar.y, 8, Math.max(8, size.height - 450)) }

  return <div className={`app ${platform === 'darwin' ? 'is-mac' : ''}`}>
    <header className="app-titlebar"><div className="app-wordmark"><ZaiMark size={28} /><span>zai<span className="wordmark-period">.</span></span><small>workspace</small></div><span className="titlebar-divider" /><div className="breadcrumb">Espacio personal<ChevronRight size={12} /><span>{project.name}</span></div>
      <div className="titlebar-actions">
        <details className="minimized-tray" ref={minimizedTray}><summary aria-label={`Ventanas minimizadas (${minimizedPanels.length})`} title="Ventanas minimizadas"><PanelsTopLeft size={16} /><span>Minimizadas</span><strong>{minimizedPanels.length}</strong></summary><div className="minimized-menu"><div className="minimized-menu-heading">Tus ventanas minimizadas</div>{!minimizedPanels.length && <p>Las ventanas que minimices aparecerán aquí.</p>}{minimizedPanels.map(({ owner, panel }) => <button key={panel.id} aria-label={`Mostrar ${panel.title} · ${owner.name}`} onClick={(event) => { restorePanel(owner, panel); event.currentTarget.closest('details')?.removeAttribute('open') }}><span className={`brand-${panel.kind}`}><ProviderMark kind={panel.kind} size={21} /></span><span><strong>{panel.title}</strong><small>{owner.name}</small></span><ArrowUpRight size={14} /></button>)}</div></details>
        <button className="command-trigger" onClick={() => { setPaletteQuery(''); setModal('palette') }}><Search size={14} /><span>Buscar o hacer algo…</span><kbd>{platform === 'darwin' ? '⌘' : 'Ctrl'} K</kbd></button><button className="icon-button" title="Cambiar apariencia" aria-label="Cambiar apariencia" onClick={() => setWorkspace((w) => ({ ...w, theme: w.theme === 'dark' ? 'light' : 'dark' }))}>{workspace.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button" title="Ayuda y atajos" onClick={() => setModal('help')}><CircleHelp size={17} /></button><button className="avatar" title="Preferencias de tu espacio" onClick={() => setModal('settings')}>Y</button></div>
      {window.zai && <div className="native-controls"><button aria-label="Minimizar aplicación" onClick={() => window.zai?.window('minimize')}><Minus size={13} /></button><button aria-label="Maximizar aplicación" onClick={() => window.zai?.window('maximize')}><Maximize2 size={11} /></button><button aria-label="Cerrar aplicación" className="native-close" onClick={async () => { try { await window.zai?.save(state.current); await window.zai?.window('close') } catch (e) { toast(readableError(e)) } }}><X size={15} /></button></div>}
    </header>
    <main className={`canvas ${tool === 'hand' ? 'hand-tool' : ''} ${workspace.grid ? 'with-grid' : ''}`} ref={viewport} onPointerDownCapture={dragCanvas}
      style={{ '--grid-x': `${project.pan.x % (24 * project.zoom)}px`, '--grid-y': `${project.pan.y % (24 * project.zoom)}px`, '--grid-size': `${24 * project.zoom}px` } as CSSProperties}>
      <div className="canvas-watermark"><ZaiMark size={340} /></div>
      <aside className={`project-sidebar floating-ui ${workspace.sidebar.collapsed ? 'collapsed' : ''}`} style={sidebarPosition} aria-label="Proyectos">
        <div className="sidebar-heading" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; startDrag(e, (dx, dy) => setWorkspace((w) => ({ ...w, sidebar: { ...w.sidebar, x: clamp(sidebarPosition.left + dx, 10, size.width - (workspace.sidebar.collapsed ? 80 : 245)), y: clamp(sidebarPosition.top + dy, 8, size.height - 200) } }))) }}>
          <span className="sidebar-symbol"><LayoutGrid size={16} /></span><span className="sidebar-heading-text">Mi espacio</span><GripHorizontal className="sidebar-grip" size={14} /><button className="icon-button" title={workspace.sidebar.collapsed ? 'Mostrar proyectos' : 'Contraer proyectos'} aria-label="Contraer proyectos" onClick={() => setWorkspace((w) => ({ ...w, sidebar: { ...w.sidebar, collapsed: !w.sidebar.collapsed } }))}>{workspace.sidebar.collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
        </div>
        {!workspace.sidebar.collapsed && <><div className="sidebar-section-label">PROYECTOS<span>{workspace.projects.length.toString().padStart(2, '0')}</span></div>{workspace.projects.length > 4 && <div className="project-search"><Search size={13} /><input aria-label="Buscar proyectos" placeholder="Buscar proyecto…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>}</>}
        <div className="project-list">{visibleProjects.map((p) => <div key={p.id} className={`project-item ${p.id === project.id ? 'active' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/zai-project', p.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/zai-project'); if (id === p.id) return; setWorkspace((w) => { const list = [...w.projects], from = list.findIndex((p) => p.id === id), to = list.findIndex((item) => item.id === p.id); if (from < 0 || to < 0) return w; const [item] = list.splice(from, 1); list.splice(to, 0, item); return { ...w, projects: list } }) }}>
          <button className="project-switch" aria-label={`Abrir proyecto ${p.name}`} onClick={() => switchProject(p.id)} title={p.name}><span className="project-glyph" style={{ '--project-color': p.color } as CSSProperties}>{p.name.charAt(0).toUpperCase()}</span><span className="project-name">{p.name}</span>{p.panels.some((panel) => runtime[panel.id]?.status === 'running') ? <span className="live-dot" /> : <span className="project-panel-count">{p.panels.length}</span>}</button><button className="project-more icon-button" aria-label={`Editar proyecto ${p.name}`} onClick={() => editProject(p)}><MoreHorizontal size={15} /></button>
        </div>)}</div>
        {!visibleProjects.length && <p className="no-project-results">Sin resultados</p>}
        <button className="new-project" onClick={newProject} title="Nuevo proyecto"><Plus size={15} /><span>Nuevo proyecto</span></button>
        {!workspace.sidebar.collapsed && <div className="sidebar-bottom"><div className="sidebar-tip"><span>Un espacio para pensar<br /><strong>en grande.</strong></span><Sparkles size={29} strokeWidth={0.8} /></div><button className="sidebar-footer-button" onClick={() => setActivityOpen(!activityOpen)}><ActivityIcon size={15} /><span>Actividad</span>{activeAgents > 0 && <i className="activity-count">{activeAgents}</i>}</button><button className="sidebar-footer-button" aria-label="Preferencias" onClick={() => setModal('settings')}><Settings2 size={15} /><span>Preferencias</span><kbd>⚙</kbd></button><div className="local-space"><span className="local-space-icon"><ZaiMark size={20} /></span><div>Tu espacio personal<small>Todo se guarda en tu equipo</small></div><span className="local-indicator" /></div></div>}
      </aside>
      <div className="project-heading"><div className="project-eyebrow"><span style={{ background: project.color }} />TU PIZARRA, A TU MANERA</div><div className="project-heading-line">{renaming === project.id ? <input autoFocus aria-label="Nombre del proyecto" defaultValue={project.name} onBlur={(e) => { if (e.target.value.trim()) updateProject(project.id, { name: e.target.value.trim() }); setRenaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} /> : <h1 onDoubleClick={() => setRenaming(project.id)} title="Doble clic para cambiar el nombre">{project.name}<span className="heading-dot">.</span></h1>}<span className="workspace-type"><span />Espacio local</span></div><p>Tus agentes, herramientas e ideas. En el mismo lugar.</p></div>
      <div className="board-top-actions floating-ui"><span className={`save-status ${saved}`}>{saved === 'saving' ? <LoaderCircle className="spin" size={12} /> : saved === 'error' ? <X size={12} /> : <Check size={13} />}<span>{saved === 'saving' ? 'Guardando…' : saved === 'error' ? 'Error al guardar' : 'Guardado localmente'}</span></span><button className="secondary-button folder-button" title={project.folder || 'Vincula la carpeta de tu proyecto'} onClick={() => void chooseFolder(project)}><FolderOpen size={14} /><span>{project.folder ? project.folder.split(/[\\/]/).filter(Boolean).pop() : 'Vincular carpeta'}</span></button><div className="launcher-anchor"><button className="primary-button new-window-button" onClick={() => setLauncher(!launcher)}><Plus size={15} />Nueva ventana<ChevronDown size={12} /></button>{launcher && <><button className="dismiss-overlay" aria-label="Cerrar menú" onClick={() => setLauncher(false)} /><div className="launcher-popover"><span className="tiny-label">AÑADE A TU PIZARRA</span>{kinds.map((kind) => <button key={kind} onClick={() => addPanel(kind)}><span className={`launcher-brand brand-${kind}`}><ProviderMark kind={kind} size={23} /></span><span><strong>{names[kind]}</strong><small>{descriptions[kind]}</small></span><Plus size={14} /></button>)}</div></>}</div></div>
      {workspace.projects.map((owner) => <div key={owner.id} className="project-world" style={{ display: owner.id === project.id ? undefined : 'none', transform: `translate(${owner.pan.x}px, ${owner.pan.y}px) scale(${owner.zoom})` }}>
        <Connections project={owner} activity={browserActivity} change={(connections) => updateProject(owner.id, { connections })} toast={toast} />
        {owner.panels.map((panel) => <Fragment key={panel.id}>{panel.minimized && <button key={panel.id} className={`canvas-icon kind-${panel.kind}`} style={{ left: panel.iconX, top: panel.iconY, zIndex: panel.z }} aria-label={`Restaurar ${panel.title}`} onClick={() => { updatePanel(owner.id, panel.id, { minimized: false }); focusPanel(owner.id, panel.id) }} onPointerDown={(e) => { const start = { x: panel.iconX, y: panel.iconY }; let moved = false; startDrag(e, (dx, dy) => { if (Math.abs(dx) + Math.abs(dy) > 5) moved = true; if (moved) updatePanel(owner.id, panel.id, { iconX: start.x + dx / owner.zoom, iconY: start.y + dy / owner.zoom }) }, () => { if (moved) { const stop = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault() }; window.addEventListener('click', stop, { capture: true, once: true }) } }) }}><span className={`canvas-icon-face brand-${panel.kind}`}><ProviderMark kind={panel.kind} size={33} />{runtime[panel.id]?.status === 'running' && <i className="live-dot" />}{runtime[panel.id]?.status === 'waiting' && <i className="attention-dot" />}</span><strong>{panel.title}</strong><small>{runtime[panel.id]?.status === 'running' ? 'Trabajando…' : 'Clic para abrir'}</small></button>}<FloatingPanel hidden={panel.minimized} panel={panel} zoom={owner.zoom} focused={focused === panel.id} status={['codex', 'claude'].includes(panel.kind) ? runtime[panel.id]?.status || 'idle' : undefined} patch={(patch) => updatePanel(owner.id, panel.id, patch)} focus={() => focusPanel(owner.id, panel.id)} minimize={() => minimize(owner, panel)} maximize={() => maximize(owner, panel)} close={() => closePanel(owner, panel)}>
          {panel.kind === 'codex' || panel.kind === 'claude' ? <AgentChat panel={panel} project={owner} runtime={runtime[panel.id] || emptyRuntime} catalog={catalogs[panel.kind]} catalogLoading={!!catalogLoading[panel.kind]} refreshCatalog={() => void refreshCatalog(panel.kind as Provider, true)} send={(text) => send(owner, panel, text)} patch={(patch) => updatePanel(owner.id, panel.id, patch)} chooseFolder={() => void chooseFolder(owner)} toast={toast} /> : panel.kind === 'browser' ? <BrowserPanel panel={panel} projectId={owner.id} connectedAgents={owner.connections.filter((edge) => edge.browserId === panel.id).map((edge) => owner.panels.find((p) => p.id === edge.agentId)?.title || 'Agente')} activity={Object.values(browserActivity).filter((event) => event.browserId === panel.id).sort((a, b) => b.time - a.time)[0]} patch={(patch) => updatePanel(owner.id, panel.id, patch)} toast={toast} onActivity={(text) => log(owner.id, text, 'info', panel.id)} focus={() => focusPanel(owner.id, panel.id)} /> : panel.kind === 'terminal' ? <Suspense fallback={<div className="terminal-welcome"><LoaderCircle className="spin" size={22} /></div>}><TerminalPanel id={panel.id} folder={owner.folder} chooseFolder={() => void chooseFolder(owner)} /></Suspense> : <div className="note-panel"><div className="note-meta"><span>UN POCO DE CLARIDAD</span><Sparkles size={14} /></div><textarea aria-label="Contenido de la nota" placeholder="Una idea, un pendiente, algo para recordar…" value={panel.note} onChange={(e) => updatePanel(owner.id, panel.id, { note: e.target.value })} /><div className="note-footer"><span>Solo para este proyecto</span><span>{panel.note.length} caracteres</span></div></div>}
        </FloatingPanel></Fragment>)}
      </div>)}
      {!project.panels.length && <div className="empty-board"><span className="empty-board-mark"><ZaiMark size={56} /></span><span className="tiny-label">TODO COMIENZA CON UNA IDEA</span><h2>Haz espacio para<br />lo que viene.</h2><p>Trae un agente, abre tu proyecto<br />y empieza a construir a tu manera.</p><button className="primary-button" onClick={() => addPanel('codex')}><Plus size={16} />Abrir mi primer agente</button><button className="text-button" onClick={() => addPanel('note')}>O empieza con una nota<ArrowUpRight size={13} /></button></div>}
      <div className="bottom-hint floating-ui">{window.zai ? <span className="connected-dot" /> : <span className="preview-dot" />}<span>{window.zai ? 'En tu equipo. A tu ritmo.' : 'Vista previa · agentes en la app de escritorio'}</span></div>
      <div className="canvas-dock floating-ui" ref={dock} style={workspace.dock.x === null ? { left: '57%', bottom: 24, transform: 'translateX(-50%)' } : { left: clamp(workspace.dock.x, 8, Math.max(8, size.width - 440)), top: clamp(workspace.dock.y || 0, 8, size.height - 70) }}>
        <button className="dock-grip" aria-label="Mover barra de herramientas" onPointerDown={(e) => { const rect = dock.current!.getBoundingClientRect(), main = viewport.current!.getBoundingClientRect(); startDrag(e, (dx, dy) => setWorkspace((w) => ({ ...w, dock: { x: clamp(rect.left - main.left + dx, 8, size.width - 440), y: clamp(rect.top - main.top + dy, 8, size.height - 70) } }))) }}><GripHorizontal size={16} /></button><button className={`dock-tool ${tool === 'pointer' ? 'selected' : ''}`} title="Seleccionar · V" aria-label="Herramienta seleccionar" onClick={() => setTool('pointer')}><MousePointer2 size={19} /></button><button className={`dock-tool ${tool === 'hand' ? 'selected' : ''}`} title="Mover pizarra · H o Espacio" aria-label="Herramienta mover pizarra" onClick={() => setTool('hand')}><Hand size={19} /></button><span className="dock-divider" />{kinds.map((kind) => <button key={kind} className={`dock-tool dock-provider brand-${kind}`} title={`Abrir ${names[kind]}`} aria-label={`Añadir ${names[kind]}`} onClick={() => addPanel(kind)}><ProviderMark kind={kind} size={kind === 'claude' ? 25 : 22} /></button>)}<span className="dock-divider" /><button className="dock-tool" title="Organizar ventanas" aria-label="Organizar ventanas" onClick={arrange}><LayoutGrid size={18} /></button><button className="dock-tool dock-add" title="Todas las acciones · Ctrl K" aria-label="Todas las acciones" onClick={() => { setPaletteQuery(''); setModal('palette') }}><Plus size={20} /></button>
      </div>
      <div className="zoom-controls floating-ui"><button className="icon-button" aria-label="Alejar pizarra" onClick={() => zoomBy(1 / 1.1)}><Minus size={14} /></button><button className="zoom-label" title="Restablecer al 100%" onClick={() => updateProject(project.id, { zoom: 1 })}>{Math.round(project.zoom * 100)}<span>%</span></button><button className="icon-button" aria-label="Acercar pizarra" onClick={() => zoomBy(1.1)}><Plus size={14} /></button><span /><button className="icon-button" title="Ver toda la pizarra · F" aria-label="Encuadrar pizarra" onClick={fitBoard}><Maximize2 size={14} /></button></div>
      {activityOpen && <aside className="activity-panel floating-ui"><div className="activity-heading"><ActivityIcon size={17} /><h2>Lo que está pasando</h2><button className="icon-button" title="Cerrar actividad" onClick={() => setActivityOpen(false)}><X size={16} /></button></div><div className="activity-project"><span style={{ background: project.color }} />{project.name}<span>{activeAgents} activos</span></div><div className="activity-list">{projectActivities.length ? projectActivities.map((a) => <button className={`activity-item activity-${a.kind}`} key={a.id} onClick={() => { if (a.panelId) { const panel = project.panels.find((p) => p.id === a.panelId); if (panel) { updatePanel(project.id, panel.id, { minimized: false }); focusPanel(project.id, panel.id) } } }}><span className="activity-timeline-dot" /><div><p>{a.text}</p><time>{new Date(a.time).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</time></div></button>) : <div className="activity-empty"><ActivityIcon size={32} strokeWidth={1} /><h3>Un nuevo comienzo.</h3><p>Las tareas, herramientas y conexiones aparecerán aquí cuando ocurran.</p></div>}</div>{projectActivities.length > 0 && <button className="clear-activity" onClick={() => setWorkspace((w) => ({ ...w, activities: w.activities.filter((a) => a.projectId !== project.id) }))}>Limpiar registro</button>}</aside>}
    </main>
    {modal && <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}><section role="dialog" aria-modal="true" aria-label={modal === 'settings' ? 'Preferencias' : modal === 'project' ? 'Proyecto' : modal === 'help' ? 'Ayuda y atajos' : 'Buscar acciones'} className={`modal modal-${modal}`}>
      <button className="modal-close icon-button" aria-label="Cerrar diálogo" onClick={() => setModal(null)}><X size={19} /></button>
      {modal === 'project' && <><span className="modal-emblem"><Folder size={25} strokeWidth={1.5} /></span><span className="tiny-label">UN LUGAR PARA CADA IDEA</span><h2>{projectEdit ? 'Tu proyecto.' : 'Un nuevo espacio.'}</h2><p className="modal-description">Agentes, notas y ventanas con su propia pizarra.</p><form onSubmit={(e) => { e.preventDefault(); saveProject() }}><label className="field-label">Nombre del proyecto<input autoFocus placeholder="¿Qué tienes en mente?" maxLength={60} value={projectDraft.name} onChange={(e) => setProjectDraft({ ...projectDraft, name: e.target.value })} /></label><label className="field-label">Un toque de color</label><div className="color-options">{colors.map((color) => <button type="button" key={color} aria-label={`Color ${color}`} className={projectDraft.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => setProjectDraft({ ...projectDraft, color })}>{projectDraft.color === color && <Check size={17} />}</button>)}</div><label className="field-label">Carpeta local<span className="optional-label">Opcional por ahora</span></label><button type="button" className="folder-picker" onClick={async () => { if (!window.zai) { toast('Disponible en la app de escritorio.'); return } const existing = workspace.projects.find((p) => p.id === projectEdit); if (existing?.panels.some((p) => p.sessionId)) { toast('Crea otro proyecto para trabajar en otra carpeta.'); return } const folder = await window.zai.chooseFolder(); if (folder) setProjectDraft({ ...projectDraft, folder }) }}><FolderOpen size={18} /><span>{projectDraft.folder || 'Elegir una carpeta'}</span><ArrowUpRight size={14} /></button><div className="project-modal-actions">{projectEdit && <button type="button" className="delete-project icon-button" title="Eliminar proyecto de Zai" aria-label="Eliminar proyecto" disabled={workspace.projects.length < 2} onClick={deleteProject}><Trash2 size={16} /></button>}<button type="submit" className="primary-button" disabled={!projectDraft.name.trim()}>{projectEdit ? 'Guardar cambios' : 'Crear proyecto'}<ArrowUpRight size={15} /></button></div></form></>}
      {modal === 'settings' && <><span className="tiny-label">QUE SE SIENTA TUYO</span><h2>Tu espacio, tu estilo.</h2><p className="modal-description">Pequeños detalles para trabajar a gusto.</p><label className="field-label">Apariencia</label><div className="theme-options">{(['dark', 'light'] as const).map((theme) => <button key={theme} className={`theme-card theme-preview-${theme} ${workspace.theme === theme ? 'selected' : ''}`} onClick={() => setWorkspace((w) => ({ ...w, theme }))}><span className="theme-preview"><i /><i /><i /></span><span>{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}{theme === 'dark' ? 'Noche tranquila' : 'Un poco de luz'}{workspace.theme === theme && <Check size={14} />}</span></button>)}</div><label className="field-label">Color de acento</label><div className="color-options">{colors.map((color) => <button key={color} aria-label={`Acento ${color}`} style={{ background: color }} onClick={() => setWorkspace((w) => ({ ...w, accent: color }))}>{workspace.accent === color && <Check size={17} />}</button>)}</div><div className="settings-row"><span>Cuadrícula de puntos<small>Una guía sutil para ordenar tus ideas.</small></span><button role="switch" aria-checked={workspace.grid} aria-label="Cuadrícula de puntos" className={`switch ${workspace.grid ? 'on' : ''}`} onClick={() => setWorkspace((w) => ({ ...w, grid: !w.grid }))}><i /></button></div><div className="settings-row"><span>Posición de los controles<small>Puedes arrastrar los paneles por sus asas.</small></span><button className="text-button" onClick={() => setWorkspace((w) => ({ ...w, sidebar: { x: 22, y: 28, collapsed: false }, dock: { x: null, y: null } }))}>Restablecer</button></div><label className="field-label">Tus agentes locales</label><div className="provider-status-list">{(['codex', 'claude'] as Provider[]).map((kind) => <div key={kind}><span className={`brand-${kind}`}><ProviderMark kind={kind} size={21} /></span><span>{names[kind]}<small>{providers[kind]?.version || (window.zai ? 'CLI no detectado' : 'Disponible en modo escritorio')}</small></span><span className={`provider-install-status ${providers[kind]?.installed ? 'detected' : ''}`}>{providers[kind]?.installed ? 'Detectado' : 'Sin conexión'}</span></div>)}</div><div className="backup-actions"><button className="secondary-button" onClick={exportWorkspace}><Download size={14} />Exportar pizarra</button><label className="secondary-button import-button"><FolderOpen size={14} />Importar copia<input type="file" accept="application/json,.json" onChange={(e) => void importWorkspace(e.target.files?.[0])} /></label></div><div className="settings-attribution"><ZaiMark size={19} /><span>Zai 0.3.1 · Hecho para construir.</span><button onClick={() => window.zai ? void window.zai.external('https://github.com/Y0RD1N/zai') : window.open('https://github.com/Y0RD1N/zai', '_blank', 'noopener,noreferrer')}>GitHub<ArrowUpRight size={12} /></button></div></>}
      {modal === 'help' && <><span className="modal-emblem"><Keyboard size={27} strokeWidth={1.2} /></span><span className="tiny-label">MENOS CLICS, MÁS IDEAS</span><h2>Muévete a tu manera.</h2><p className="modal-description">Arrastra las ventanas por su título. El asa de la esquina cambia su tamaño.</p><div className="shortcut-list">{[['Buscar acciones', `${platform === 'darwin' ? '⌘' : 'Ctrl'} K`], ['Mover la pizarra', 'Espacio + arrastrar'], ['Herramienta mano', 'H'], ['Seleccionar', 'V'], ['Ver toda la pizarra', 'F'], ['Nueva nota', 'N'], ['Acercar / alejar', 'Ctrl + rueda'], ['Enviar mensaje', 'Enter'], ['Nueva línea en el chat', 'Shift Enter']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-footnote">Los agentes trabajan en la carpeta vinculada a cada proyecto. Inicia sesión con <code>codex login</code> o <code>claude auth login</code> antes de conversar. Minimizar una ventana mantiene su agente activo.</p><button className="primary-button full-width" onClick={() => setModal(null)}>Vamos a construir<ArrowUpRight size={15} /></button></>}
      {modal === 'palette' && <><div className="palette-search"><Search size={20} /><input autoFocus aria-label="Buscar acciones" placeholder="¿Qué quieres hacer?" value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commands.find((c) => c.title.toLowerCase().includes(paletteQuery.toLowerCase()))?.run() }} /><kbd>esc</kbd></div><div className="palette-results"><span className="tiny-label">TU SIGUIENTE PASO</span>{commands.filter((c) => (c.title + c.detail).toLowerCase().includes(paletteQuery.toLowerCase())).map((command) => <button key={command.id} onClick={command.run}><span className={`palette-icon brand-${command.id}`}>{command.icon}</span><span><strong>{command.title}</strong><small>{command.detail}</small></span><ArrowUpRight size={15} /></button>)}{!commands.some((c) => (c.title + c.detail).toLowerCase().includes(paletteQuery.toLowerCase())) && <p className="palette-no-results">No encontramos esa acción.</p>}</div><div className="palette-footer"><Command size={12} /><span>Un espacio para tus ideas.</span><kbd>Enter</kbd><span>para abrir</span></div></>}
    </section></div>}
    {notice && <div className="toast" role="status"><span><ZaiMark size={18} /></span><p>{notice}</p><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>
}

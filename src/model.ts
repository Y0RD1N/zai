import type { Activity, Panel, PanelKind, Project, Workspace } from './types'
import { defaultPermissions, restorePermissions } from './permissions'

export const uid = () => crypto.randomUUID()
export const names: Record<PanelKind, string> = { codex: 'Codex', claude: 'Claude', zai: 'Zai Agent', browser: 'Navegador', note: 'Notas de la idea', terminal: 'Terminal' }
export const colors = ['#ed987c', '#a2b797', '#a6a2cd', '#e3bc75', '#8eb6c5']
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export function makePanel(kind: PanelKind, index = 0): Panel {
  return {
    id: uid(), kind, title: names[kind], x: 60 + index % 5 * 48, y: 60 + index % 5 * 40,
    width: kind === 'note' ? 280 : kind === 'browser' ? 570 : 450,
    height: kind === 'note' ? 240 : kind === 'browser' ? 320 : 420,
    z: index + 1, minimized: false, iconX: 40 + index * 100, iconY: 30,
    url: '', note: '', messages: [], timeline: [], model: '', effort: '', speed: 'default', permissions: { ...defaultPermissions },
  }
}
export function makeProject(name: string, color = colors[0], starter = false): Project {
  const panels: Panel[] = []
  if (starter) {
    panels.push({ ...makePanel('codex', 0), x: 0, y: 0, width: 440, height: 410 })
    panels.push({ ...makePanel('claude', 1), x: 470, y: 38, width: 440, height: 410 })
    panels.push({ ...makePanel('browser', 2), x: 35, y: 450, width: 565, height: 295 })
    panels.push({ ...makePanel('note', 3), x: 640, y: 490, width: 270, height: 240, note: 'Una idea para empezar…\n\n¿Qué quieres construir?\n¿Quién se encarga de cada parte?\n\nEste espacio es tuyo. ✦' })
  }
  const zoom = typeof window === 'undefined' ? 0.9 : clamp(Math.min((window.innerWidth - 345) / 910, (window.innerHeight - 284) / 745, 0.9), 0.35, 0.9)
  return { id: uid(), name, color, folder: '', panels, connections: [], pan: { x: 305, y: 137 }, zoom }
}
export function initialWorkspace(): Workspace {
  const project = makeProject('Zai', colors[0], true)
  return { version: 1, projects: [project], activeProjectId: project.id, theme: 'dark', accent: colors[0],
    sidebar: { x: 22, y: 28, collapsed: false }, dock: { x: null, y: null }, activities: [], grid: true }
}
export function hydrate(value: unknown): Workspace | null {
  try {
    const data = value as Workspace
    if (!data || data.version !== 1 || !Array.isArray(data.projects) || !data.projects.length || data.projects.length > 200) return null
    for (const project of data.projects) {
      if (typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.panels)) return null
      project.folder = typeof project.folder === 'string' ? project.folder : ''
      project.zoom = clamp(Number(project.zoom) || 0.9, 0.35, 1.5)
      project.pan = { x: Number(project.pan?.x) || 305, y: Number(project.pan?.y) || 137 }
      project.color = /^#[\da-f]{6}$/i.test(project.color) ? project.color : colors[0]
      project.panels = project.panels.filter((p) => p && Object.hasOwn(names, p.kind) && typeof p.id === 'string').map((p) => ({
        ...makePanel(p.kind), ...p, x: Number(p.x) || 0, y: Number(p.y) || 0,
        model: typeof p.model === 'string' ? p.model : '', effort: typeof p.effort === 'string' ? p.effort : '', speed: typeof p.speed === 'string' && p.speed ? p.speed : 'default',
        generation: p.generation && {
          maxOutputTokens: Number.isSafeInteger(p.generation.maxOutputTokens) && p.generation.maxOutputTokens! > 0 && p.generation.maxOutputTokens! <= 1_000_000 ? p.generation.maxOutputTokens : undefined,
          reasoningBudget: Number.isSafeInteger(p.generation.reasoningBudget) && p.generation.reasoningBudget! > 0 && p.generation.reasoningBudget! <= 1_000_000 ? p.generation.reasoningBudget : undefined,
        },
        permissions: restorePermissions(p.permissions),
        width: clamp(Number(p.width) || 440, 250, 2400), height: clamp(Number(p.height) || 410, 190, 2000),
        context: p.context ? { ...p.context, compacting: false } : undefined,
        messages: Array.isArray(p.messages) ? p.messages.filter((m) => m && typeof m.text === 'string' && ['user', 'assistant'].includes(m.role)) : [],
        timeline: Array.isArray(p.timeline) ? p.timeline.filter((item) => item && (item.kind === 'message' && typeof item.id === 'string' || item.kind === 'tool' && typeof item.tool?.id === 'string' && typeof item.tool.status === 'string')).map((item) => item.kind === 'tool' && item.tool.status === 'running' ? { ...item, tool: { ...item.tool, status: 'stopped' } } : item) : (p.messages || []).map((message) => ({ kind: 'message' as const, id: message.id })),
      }))
      const pairs = new Set<string>()
      project.connections = (Array.isArray(project.connections) ? project.connections : []).filter((edge) => {
        if (!edge || typeof edge.id !== 'string' || !project.panels.some((p) => p.id === edge.agentId && ['codex', 'claude', 'zai'].includes(p.kind)) || !project.panels.some((p) => p.id === edge.browserId && p.kind === 'browser')) return false
        const key = `${edge.agentId}:${edge.browserId}`
        if (pairs.has(key)) return false
        pairs.add(key); return true
      }).map((edge) => ({ ...edge, agentSide: edge.agentSide === 'left' ? 'left' : 'right', browserSide: edge.browserSide === 'right' ? 'right' : 'left' }))
    }
    if (!data.projects.some((p) => p.id === data.activeProjectId)) data.activeProjectId = data.projects[0].id
    const background = data.background && /^#[a-f\d]{6}$/i.test(data.background.color) ? { color: data.background.color, opacity: clamp(Number(data.background.opacity) || 0, 0, 1), image: typeof data.background.image === 'string' && /^[a-f\d-]{36}$/i.test(data.background.image) ? data.background.image : undefined } : undefined
    return { ...initialWorkspace(), ...data, background, theme: data.theme === 'light' ? 'light' : 'dark', accent: colors.includes(data.accent) ? data.accent : colors[0],
      activities: Array.isArray(data.activities) ? data.activities.slice(0, 150) : [], sidebar: data.sidebar || { x: 22, y: 28, collapsed: false }, dock: data.dock || { x: null, y: null } }
  } catch { return null }
}
export function activity(projectId: string, text: string, kind: Activity['kind'] = 'info', panelId?: string): Activity {
  return { id: uid(), projectId, text, kind, panelId, time: Date.now() }
}
export function normalizeUrl(input: string): string {
  const text = input.trim()
  if (!text) return ''
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(text) ? `http://${text}` : `https://${text}`)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Usa una dirección http o https sin credenciales.')
  return url.toString()
}

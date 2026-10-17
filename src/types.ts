export type Provider = 'codex' | 'claude'
export type PanelKind = Provider | 'browser' | 'note' | 'terminal'
export type AgentStatus = 'idle' | 'starting' | 'running' | 'waiting' | 'error' | 'stopped'
export interface Message { id: string; role: 'user' | 'assistant'; text: string; time: number }
export interface Tool { id: string; name?: string; detail?: string; status: string; output?: string }
export type ChatItem = { kind: 'message'; id: string } | { kind: 'tool'; tool: Tool }
export interface Question { id?: string; question: string; header?: string; options?: { label: string; description?: string }[] }
export interface Approval { requestId: string; title: string; detail: string; kind: string; questions?: Question[] }
export interface Panel {
  id: string; kind: PanelKind; title: string; x: number; y: number; width: number; height: number; z: number
  minimized: boolean; iconX: number; iconY: number; maximized?: boolean
  previousBounds?: { x: number; y: number; width: number; height: number }
  url: string; note: string; messages: Message[]; timeline?: ChatItem[]; sessionId?: string; model: string; effort: string; speed: string
}
export interface Project { id: string; name: string; color: string; folder: string; panels: Panel[]; pan: { x: number; y: number }; zoom: number }
export interface Activity { id: string; projectId: string; panelId?: string; text: string; time: number; kind: 'info' | 'success' | 'error' }
export interface Workspace {
  version: 1; projects: Project[]; activeProjectId: string; theme: 'dark' | 'light'; accent: string
  sidebar: { x: number; y: number; collapsed: boolean }; dock: { x: number | null; y: number | null }
  activities: Activity[]; grid: boolean
}
export interface ConversationMetrics { inputTokens: number; outputTokens: number; costUsd?: number }
export interface AgentConfiguration { model?: string; effort?: string | null; speed?: string; speedReason?: string }
export interface AgentRuntime { status: AgentStatus; tools: Tool[]; approvals: Approval[]; error?: string; metrics?: ConversationMetrics; configuration?: AgentConfiguration }
export type AgentEvent = { id: string } & (
  { type: 'status'; status: AgentStatus } |
  { type: 'message'; messageId: string; text: string; delta: boolean } |
  { type: 'tool'; tool: Tool } |
  { type: 'session'; sessionId: string; model?: string } |
  { type: 'approval'; approval: Approval } |
  { type: 'resolved'; requestId: string } |
  ({ type: 'configuration' } & AgentConfiguration) |
  { type: 'metrics'; metrics: ConversationMetrics } |
  { type: 'error'; message: string }
)
export interface ProviderInfo { installed: boolean; version?: string; path?: string }
export interface AgentModel {
  id: string; resolvedModel?: string; name: string; description: string; isDefault: boolean; defaultEffort: string
  efforts: { id: string; description: string }[]; speeds: { id: string; name: string; description: string }[]
}
export interface UsageWindow { id: string; label: string; group?: string; usedPercent: number | null; resetsAt: number | null; status?: string }
export interface ProviderUsage { windows: UsageWindow[]; plan?: string; updatedAt: number; note?: string }
export interface ProviderCatalog { models: AgentModel[]; defaults: { model: string; effort: string }; usage: ProviderUsage; updatedAt: number; error?: string }
export interface DesktopBridge {
  load(): Promise<Workspace | null>; save(data: Workspace): Promise<void>
  chooseFolder(): Promise<string | null>; revealFolder(cwd: string): Promise<string>
  info(): Promise<{ platform: string; version: string; home: string }>
  providers(): Promise<Record<Provider, ProviderInfo>>
  catalog(provider: Provider, refresh?: boolean): Promise<ProviderCatalog>
  onProvider(listener: (event: { provider: Provider; data: ProviderCatalog }) => void): () => void
  external(url: string): Promise<void>; window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  finishClose(): Promise<void>; onClosing(listener: () => void): () => void
  send(request: { id: string; provider: Provider; text: string; cwd: string; sessionId?: string; model?: string; effort?: string; speed?: string }): Promise<void>
  stop(id: string): Promise<void>; closeAgent(id: string): Promise<void>
  respond(id: string, requestId: string, response: { allow: boolean; answers?: Record<string, unknown> }): Promise<void>
  onAgent(listener: (event: AgentEvent) => void): () => void
  startTerminal(request: { id: string; cwd: string; cols: number; rows: number }): Promise<{ buffer: string }>
  writeTerminal(id: string, data: string): Promise<void>; resizeTerminal(id: string, cols: number, rows: number): Promise<void>
  closeTerminal(id: string): Promise<void>
  onTerminalData(listener: (event: { id: string; data: string }) => void): () => void
  onTerminalExit(listener: (event: { id: string; exitCode: number }) => void): () => void
}
declare global { interface Window { zai?: DesktopBridge } }

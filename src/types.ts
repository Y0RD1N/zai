export type Provider = 'codex' | 'claude' | 'zai'
export type PanelKind = Provider | 'browser' | 'note' | 'terminal'
export type AgentStatus = 'idle' | 'starting' | 'running' | 'waiting' | 'error' | 'stopped'
export interface Message { id: string; role: 'user' | 'assistant'; text: string; time: number }
export interface Tool { id: string; name?: string; detail?: string; status: string; output?: string }
export type ChatItem = { kind: 'message'; id: string } | { kind: 'tool'; tool: Tool }
export interface Question { id?: string; question: string; header?: string; options?: { label: string; description?: string }[] }
export interface Approval { requestId: string; title: string; detail: string; kind: string; questions?: Question[] }
export interface AgentPermissions {
  codexSandbox: 'read-only' | 'workspace-write' | 'danger-full-access'; codexApproval: 'on-request' | 'untrusted' | 'never'
  codexNetwork: boolean; claudeMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  zaiMode?: 'ask' | 'edit' | 'plan' | 'auto'
  browserAccess: 'read-only' | 'ask' | 'control'
}
export interface BrowserConnection { id: string; agentId: string; browserId: string; agentSide: 'left' | 'right'; browserSide: 'left' | 'right' }
export interface BrowserActivity { agentId: string; browserId: string; operationId: string; action: string; phase: 'started' | 'completed' | 'error'; time: number; error?: string }
export interface BrowserGraphProject { id: string; panels: { id: string; kind: PanelKind; visible?: boolean }[]; connections: BrowserConnection[] }
export interface GenerationOptions { maxOutputTokens?: number; reasoningBudget?: number }
export interface Panel {
  id: string; kind: PanelKind; title: string; x: number; y: number; width: number; height: number; z: number
  minimized: boolean; iconX: number; iconY: number; maximized?: boolean
  previousBounds?: { x: number; y: number; width: number; height: number }
  connectionId?: string;
  url: string; note: string; messages: Message[]; timeline?: ChatItem[]; sessionId?: string; generation?: GenerationOptions; model: string; effort: string; speed: string; permissions: AgentPermissions
}
export interface Project { id: string; name: string; color: string; folder: string; panels: Panel[]; connections: BrowserConnection[]; pan: { x: number; y: number }; zoom: number }
export interface Activity { id: string; projectId: string; panelId?: string; text: string; time: number; kind: 'info' | 'success' | 'error' }
export interface Workspace {
  version: 1; projects: Project[]; activeProjectId: string; theme: 'dark' | 'light'; accent: string
  sidebar: { x: number; y: number; collapsed: boolean }; dock: { x: number | null; y: number | null }
  activities: Activity[]; grid: boolean; background?: CanvasBackground
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
  contextWindow?: number; maxOutputTokens?: number; reasoningBudget?: boolean; speedNote?: string
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
  disconnectBrowser(agentId: string, browserId: string): Promise<void>
  graphics(): Promise<GraphicsInfo>
  setGraphics(mode: 'auto' | 'off'): Promise<GraphicsInfo>
  apiProfiles(): Promise<APIProfile[]>
  saveAPIProfile(profile: APIProfileInput): Promise<APIProfile>
  deleteAPIProfile(id: string): Promise<void>
  apiCatalog(id: string, model?: string, refresh?: boolean): Promise<ProviderCatalog>
  importBackground(): Promise<string | null>
  generateBackground(request: { profileId: string; model: string; prompt: string; workflow?: string }): Promise<string>
  cancelBackground(): Promise<void>
  syncBrowserGraph(projects: BrowserGraphProject[]): Promise<void>
  registerBrowser(data: { id: string; projectId: string; guestId: number }): Promise<void>
  onBrowserNavigate(listener: (event: { browserId: string; url: string }) => void): () => void
  onBrowserActivity(listener: (event: BrowserActivity) => void): () => void
  external(url: string): Promise<void>; window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  finishClose(): Promise<void>; onClosing(listener: () => void): () => void
  send(request: { id: string; provider: Provider; text: string; cwd: string; sessionId?: string; connectionId?: string; model?: string; effort?: string; speed?: string; generation?: GenerationOptions; permissions?: AgentPermissions }): Promise<void>
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

export type APIKind = 'deepseek' | 'openrouter' | 'ollama-cloud' | 'ollama-local' | 'compatible' | 'image-api' | 'automatic1111' | 'comfyui'
export interface APIProfile { id: string; name: string; kind: APIKind; baseUrl: string; model: string; hasKey: boolean; storage: 'encrypted' | 'session' | 'none' }
export interface APIProfileInput { id?: string; name: string; kind: APIKind; baseUrl: string; model: string; apiKey?: string; clearKey?: boolean }
export interface CanvasBackground { color: string; image?: string; opacity: number }

export interface GraphicsInfo { mode: 'auto' | 'off'; enabled: boolean; hardware: boolean; renderer: string; reason?: string; features: Record<string, string>; requiresRestart: boolean }

export type BackgroundChange = (value: CanvasBackground | undefined | ((current?: CanvasBackground) => CanvasBackground | undefined)) => void

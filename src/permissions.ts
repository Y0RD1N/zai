import type { AgentPermissions, Panel } from './types'

export const defaultPermissions: AgentPermissions = { codexSandbox: 'workspace-write', codexApproval: 'on-request', codexNetwork: false, claudeMode: 'default', browserAccess: 'ask', zaiMode: 'ask' }
export function restorePermissions(value?: Partial<AgentPermissions>): AgentPermissions {
  const p = value || {}
  return {
    codexSandbox: ['read-only', 'workspace-write', 'danger-full-access'].includes(p.codexSandbox || '') ? p.codexSandbox! : 'workspace-write',
    codexApproval: ['on-request', 'untrusted', 'never'].includes(p.codexApproval || '') ? p.codexApproval! : 'on-request',
    codexNetwork: p.codexNetwork === true,
    claudeMode: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'].includes(p.claudeMode || '') ? p.claudeMode! : 'default',
    zaiMode: ['ask', 'edit', 'plan', 'auto'].includes(p.zaiMode || '') ? p.zaiMode : 'ask',
    browserAccess: ['read-only', 'ask', 'control'].includes(p.browserAccess || '') ? p.browserAccess! : 'ask',
  }
}
export function permissionLabel(panel: Panel) {
  const p = panel.permissions || defaultPermissions
  return panel.kind === 'zai' ? ({ ask: 'Preguntar', edit: 'Ediciones', plan: 'Plan', auto: 'Autónomo' }[p.zaiMode || 'ask']) : panel.kind === 'codex' ? ({ 'read-only': 'Lectura', 'workspace-write': 'Proyecto', 'danger-full-access': 'Completo' }[p.codexSandbox])
    : ({ default: 'Preguntar', acceptEdits: 'Ediciones', plan: 'Plan', dontAsk: 'Reglas', bypassPermissions: 'Completo' }[p.claudeMode])
}

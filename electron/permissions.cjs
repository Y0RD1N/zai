const defaults = Object.freeze({ codexSandbox: 'workspace-write', codexApproval: 'on-request', codexNetwork: false, claudeMode: 'default', browserAccess: 'ask', zaiMode: 'ask' })
const choices = { zaiMode: ['ask', 'edit', 'plan', 'auto'], codexSandbox: ['read-only', 'workspace-write', 'danger-full-access'], codexApproval: ['on-request', 'untrusted', 'never'],
  claudeMode: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'], browserAccess: ['read-only', 'ask', 'control'] }
function permissions(value) {
  if (value === undefined) return { ...defaults }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Permisos inválidos.')
  const result = { ...defaults }
  for (const [key, allowed] of Object.entries(choices)) {
    if (value[key] !== undefined) {
      if (!allowed.includes(value[key])) throw new Error(`Permiso ${key} inválido.`)
      result[key] = value[key]
    }
  }
  if (value.codexNetwork !== undefined && typeof value.codexNetwork !== 'boolean') throw new Error('Permiso de red inválido.')
  result.codexNetwork = value.codexNetwork ?? defaults.codexNetwork
  return result
}
function codexThreadPermissions(value) {
  const p = permissions(value)
  return { sandbox: p.codexSandbox, approvalPolicy: p.codexApproval }
}
function codexTurnPermissions(value, cwd) {
  const p = permissions(value)
  const sandboxPolicy = p.codexSandbox === 'danger-full-access' ? { type: 'dangerFullAccess' }
    : p.codexSandbox === 'read-only' ? { type: 'readOnly', networkAccess: p.codexNetwork }
      : { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: p.codexNetwork, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
  return { sandboxPolicy, approvalPolicy: p.codexApproval }
}
function browserPermission(provider, value, mutates) {
  if (!mutates) return 'allow'
  const p = permissions(value)
  if (provider === 'zai' && p.zaiMode === 'plan') return 'deny'
  if (p.browserAccess === 'read-only' || provider === 'codex' && p.codexSandbox === 'read-only' || provider === 'claude' && p.claudeMode === 'plan') return 'deny'
  if (p.browserAccess === 'control') return 'allow'
  if (provider === 'codex' && p.codexApproval === 'never' || provider === 'claude' && p.claudeMode === 'dontAsk') return 'deny'
  return 'ask'
}
module.exports = { defaults, permissions, codexThreadPermissions, codexTurnPermissions, browserPermission }

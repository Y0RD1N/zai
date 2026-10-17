import type { AgentPermissions, Panel } from '../types'
import { defaultPermissions } from '../permissions'
import { AgentSelect } from './AgentSelect'

export function PermissionsSettings({ panel, busy, patch }: { panel: Panel; busy: boolean; patch: (value: Partial<Panel>) => void }) {
  const p = panel.permissions || defaultPermissions
  const change = (value: Partial<AgentPermissions>) => patch({ permissions: { ...p, ...value } })
  return <div className="permission-settings">
    {panel.kind === 'zai' ? <><div className="agent-field">Herramientas de Zai<AgentSelect label="Permisos de Zai Agent" value={p.zaiMode || 'ask'} disabled={busy} onChange={(value) => change({ zaiMode: value as AgentPermissions['zaiMode'] })} options={[
      { value: 'ask', label: 'Preguntar antes de editar o ejecutar', description: 'Lecturas libres; cada escritura y comando requiere permiso.', badge: 'Habitual' },
      { value: 'edit', label: 'Aceptar ediciones del proyecto', description: 'Escritura dentro del proyecto; los comandos piden permiso.' },
      { value: 'plan', label: 'Planificar y leer', description: 'Impide escrituras, comandos y modificaciones del navegador.' },
      { value: 'auto', label: 'Autónomo', description: 'Ediciones y comandos sin aprobación; se ejecutan con tus permisos.' },
    ]} /></div><p className="provider-note">Las herramientas de archivos se limitan a la carpeta vinculada y comprueban enlaces simbólicos. Los comandos se ejecutan con los permisos de tu usuario: Zai no ofrece un sandbox del sistema para este motor.</p></> : panel.kind === 'codex' ? <>
      <div className="agent-field">Acceso a archivos<AgentSelect label="Acceso a archivos de Codex" disabled={busy} value={p.codexSandbox} onChange={(value) => change({ codexSandbox: value as AgentPermissions['codexSandbox'] })} options={[
        { value: 'read-only', label: 'Solo lectura', description: 'Inspeccionar archivos sin permitir su escritura.' },
        { value: 'workspace-write', label: 'Escritura en el proyecto', description: 'Editar dentro de la carpeta de este proyecto.', badge: 'Habitual' },
        { value: 'danger-full-access', label: 'Acceso completo al sistema', description: 'Comandos con los permisos de tu usuario y acceso a red.' },
      ]} /></div>
      <div className="agent-field">Aprobaciones<AgentSelect label="Aprobaciones de Codex" disabled={busy} value={p.codexApproval} onChange={(value) => change({ codexApproval: value as AgentPermissions['codexApproval'] })} options={[
        { value: 'on-request', label: 'Cuando el agente solicite permiso', description: 'Codex decide cuándo pedir una aprobación.' },
        { value: 'untrusted', label: 'Preguntar por comandos no confiables', description: 'Los comandos fuera de la lista de confianza requieren permiso.' },
        { value: 'never', label: 'No preguntar; aplicar el acceso elegido', description: 'Las operaciones no permitidas se rechazan sin preguntar.' },
      ]} /></div>
      <label className="permission-toggle"><input type="checkbox" aria-label="Red de los comandos de Codex" disabled={busy || p.codexSandbox === 'danger-full-access'} checked={p.codexSandbox === 'danger-full-access' || p.codexNetwork} onChange={(e) => change({ codexNetwork: e.target.checked })} /><span>Permitir red en los comandos</span></label>
      <p className="provider-note">Codex aplica su sandbox y política de aprobación a cada turno. La escritura en el proyecto no concede escritura general en otras carpetas. La red del navegador conectado se controla por separado.</p>
      {p.codexSandbox === 'danger-full-access' && <p className="provider-note speed-notice">Este acceso permite que los comandos lean y modifiquen archivos fuera del proyecto y utilicen la red.</p>}
    </> : <>
      <div className="agent-field">Modo de permisos de Claude<AgentSelect label="Modo de permisos de Claude" disabled={busy} value={p.claudeMode} onChange={(value) => change({ claudeMode: value as AgentPermissions['claudeMode'] })} options={[
        { value: 'default', label: 'Preguntar cuando se necesite permiso', description: 'Conserva las aprobaciones habituales de Claude.', badge: 'Habitual' },
        { value: 'acceptEdits', label: 'Aceptar ediciones de archivos', description: 'Aprueba las ediciones; los comandos mantienen sus reglas.' },
        { value: 'plan', label: 'Planificar antes de ejecutar', description: 'Investigar y proponer un plan con el modo Plan nativo.' },
        { value: 'dontAsk', label: 'Solo operaciones ya permitidas; no preguntar', description: 'Rechaza las operaciones que necesiten aprobación.' },
        { value: 'bypassPermissions', label: 'Acceso completo sin aprobaciones normales', description: 'Ejecuta con los permisos de tu usuario, sin las preguntas habituales.' },
      ]} /></div>
      <p className="provider-note">Claude aplica su modo nativo y las reglas de sus ajustes. Aceptar ediciones no aprueba automáticamente todos los comandos. Las reglas obligatorias del proveedor siguen aplicándose.</p>
      {p.claudeMode === 'bypassPermissions' && <p className="provider-note speed-notice">Este modo permite ejecutar comandos y editar archivos con los permisos de tu usuario, sin las aprobaciones habituales.</p>}
    </>}
    <div className="agent-field">Navegadores conectados<AgentSelect label={`Permisos del navegador de ${panel.title}`} disabled={busy} value={p.browserAccess} onChange={(value) => change({ browserAccess: value as AgentPermissions['browserAccess'] })} options={[
      { value: 'read-only', label: 'Solo leer y capturar', description: 'Ver el contenido y tomar capturas de las páginas abiertas.' },
      { value: 'ask', label: 'Preguntar antes de navegar o interactuar', description: 'Cada navegación o interacción requiere tu aprobación.', badge: 'Habitual' },
      { value: 'control', label: 'Permitir navegación y control', description: 'Navegar, pulsar, escribir y recorrer las páginas conectadas.' },
    ]} /></div>
    <p className="provider-note">Solo se accede a los navegadores unidos a este chat por un hilo. Solo lectura de Codex y el modo Plan de Claude impiden estas acciones aunque aquí elijas control. Desconectar el hilo revoca el acceso.</p>
    {busy && <p className="provider-note">Los cambios estarán disponibles al terminar el turno.</p>}
  </div>
}

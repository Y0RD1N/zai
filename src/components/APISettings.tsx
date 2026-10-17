import { errorMessage } from '../errors'
import { useEffect, useState } from 'react'
import { Check, KeyRound, LoaderCircle, Plus, Server, Trash2 } from 'lucide-react'
import type { APIKind, APIProfile, APIProfileInput } from '../types'
import { AgentSelect } from './AgentSelect'
import { apiKinds, chatAPIKinds, newAPIProfile } from '../api-connections'

export function APISettings({ toast, initialKind, chatOnly = false, onSaved }: {
  toast: (message: string) => void
  initialKind?: APIKind
  chatOnly?: boolean
  onSaved?: (profile: APIProfile) => void
}) {
  const [profiles, setProfiles] = useState<APIProfile[]>([])
  const [draft, setDraft] = useState<APIProfileInput | null>(() => initialKind ? newAPIProfile(initialKind) : null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const refresh = async () => {
    try { setProfiles(await window.zai?.apiProfiles?.() || []) }
    catch (e) { toast(errorMessage(e)) }
  }
  useEffect(() => { void refresh() }, [])
  const kinds = chatOnly ? chatAPIKinds : apiKinds
  const visibleProfiles = profiles.filter((profile) => kinds.some((kind) => kind.value === profile.kind))
  const existing = profiles.find((profile) => profile.id === draft?.id)
  const keepsKey = existing?.hasKey && !draft?.clearKey && existing.kind === draft?.kind && existing.baseUrl === draft?.baseUrl.replace(/\/$/, '')
  const requiresKey = !!draft && ['deepseek', 'openrouter', 'ollama-cloud', 'image-api'].includes(draft.kind)
  const edit = (profile: APIProfile) => {
    setDraft({ id: profile.id, name: profile.name, kind: profile.kind, baseUrl: profile.baseUrl, model: profile.model, apiKey: '' })
    setMessage('')
  }
  const add = (kind: APIKind = 'deepseek') => { setDraft(newAPIProfile(kind)); setMessage('') }
  const changed = () => { window.dispatchEvent(new Event('zai-api-profiles')); void refresh() }
  const submit = async () => {
    if (!window.zai?.saveAPIProfile || !draft) { toast('Configura las API en la aplicación de escritorio.'); return }
    setSaving(true); setMessage('')
    try {
      const profile = await window.zai.saveAPIProfile(draft)
      setDraft(null); changed(); onSaved?.(profile)
      setMessage(profile.storage === 'session'
        ? 'Conexión guardada. La clave durará solo esta sesión: el almacén del sistema no ofrece cifrado seguro.'
        : 'Conexión guardada. Ya puedes elegirla en una ventana de Zai Agent.')
    } catch (e) { toast(errorMessage(e)) }
    finally { setSaving(false) }
  }
  return <section className={`custom-settings ${chatOnly ? 'api-settings-direct' : ''}`}>
    <div className="settings-section-title">
      <KeyRound size={16} /><div><h3>Conexiones de IA</h3><p>Tu proveedor, tu modelo. Zai Agent viene integrado.</p></div>
      <button className="icon-button" aria-label="Añadir conexión API" onClick={() => add()}><Plus size={17} /></button>
    </div>
    <div className="api-profile-list">{visibleProfiles.map((profile) => <div key={profile.id}>
      <Server size={17} />
      <button disabled={saving} onClick={() => edit(profile)}><strong>{profile.name}</strong><small>{apiKinds.find((kind) => kind.value === profile.kind)?.label} · {profile.storage === 'session' ? 'Clave en esta sesión' : profile.hasKey ? 'Clave cifrada' : 'Sin clave'}</small></button>
      <button className="icon-button" aria-label={`Eliminar conexión ${profile.name}`} disabled={saving} onClick={async () => {
        try { await window.zai?.deleteAPIProfile(profile.id); if (draft?.id === profile.id) setDraft(null); changed() }
        catch (e) { toast(errorMessage(e)) }
      }}><Trash2 size={13} /></button>
    </div>)}</div>
    {!draft && <div className="api-provider-picker">
      <p className="tiny-label">{visibleProfiles.length ? 'AÑADIR OTRA CONEXIÓN' : 'ELIGE TU PROVEEDOR'}</p>
      <div className="api-provider-grid">{kinds.map((kind) => <button key={kind.value} onClick={() => add(kind.value)}>
        <span className="api-provider-symbol">{kind.value.startsWith('ollama') ? <Server size={17} /> : <KeyRound size={17} />}</span>
        <span><strong>{kind.label}</strong><small>{kind.description}</small></span><Plus size={14} />
      </button>)}</div>
    </div>}
    {draft && <form className="api-profile-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div className="agent-field">Proveedor<AgentSelect label="Proveedor de la conexión" value={draft.kind} options={kinds} disabled={saving}
        onChange={(kind) => setDraft({ ...newAPIProfile(kind as APIKind), id: draft.id, clearKey: true })} /></div>
      <div className="agent-field-pair">
        <label className="agent-field">Nombre<input aria-label="Nombre de la conexión" autoFocus required maxLength={80} disabled={saving} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="agent-field">Modelo preferido<input aria-label="Modelo preferido de la conexión" placeholder="Opcional · ID del modelo" maxLength={200} disabled={saving} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
      </div>
      <label className="agent-field">Dirección del servidor<input aria-label="Dirección del proveedor" required disabled={saving} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label>
      <label className="agent-field">API key<input aria-label="Clave API" type="password" autoComplete="new-password" spellCheck={false} required={requiresKey && !keepsKey} disabled={saving}
        placeholder={keepsKey ? 'Conservar la clave guardada' : requiresKey ? 'Pega aquí la API key de tu proveedor' : 'Opcional si tu servidor no requiere clave'}
        value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} /></label>
      {draft.id && <label className="permission-toggle"><input type="checkbox" checked={draft.clearKey || false} disabled={saving} onChange={(e) => setDraft({ ...draft, clearKey: e.target.checked })} />Eliminar clave anterior</label>}
      <p className="provider-note">Las claves se guardan con el cifrado del sistema cuando está disponible. No se incluyen en la pizarra ni en las exportaciones. Cambiar el servidor elimina la clave anterior.</p>
      <div className="settings-form-actions">
        <button type="button" className="text-button" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Guardar conexión</button>
      </div>
    </form>}
    {message && <p className="provider-note" role="status">{message}</p>}
  </section>
}

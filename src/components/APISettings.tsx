import { errorMessage } from '../errors'
import { useEffect, useState } from 'react'
import { Check, KeyRound, LoaderCircle, Plus, Server, Trash2 } from 'lucide-react'
import type { APIKind, APIProfile, APIProfileInput } from '../types'
import { AgentSelect } from './AgentSelect'
export const apiKinds: { value: APIKind; label: string; url: string; description: string }[] = [
  { value: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', description: 'Modelos y herramientas mediante tu cuenta API.' },
  { value: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', description: 'Muchos modelos de chat y generación de imágenes.' },
  { value: 'ollama-cloud', label: 'Ollama Cloud', url: 'https://ollama.com', description: 'Inferencia en la nube con tu clave de Ollama.' },
  { value: 'ollama-local', label: 'Ollama local', url: 'http://localhost:11434', description: 'Conecta un motor Ollama que ya esté ejecutándose.' },
  { value: 'compatible', label: 'API de chat compatible', url: 'http://localhost:1234/v1', description: 'Servidores OpenAI compatibles, como LM Studio o vLLM.' },
  { value: 'image-api', label: 'API de imágenes', url: 'https://api.openai.com/v1', description: 'OpenAI o un servidor compatible con images/generations.' },
  { value: 'automatic1111', label: 'Automatic1111 / Forge', url: 'http://127.0.0.1:7860', description: 'Generación local con la opción --api del motor activada.' },
  { value: 'comfyui', label: 'ComfyUI', url: 'http://127.0.0.1:8188', description: 'Generación local mediante tu workflow en formato API.' },
]
const blank = (): APIProfileInput => ({ name: 'DeepSeek', kind: 'deepseek', baseUrl: apiKinds[0].url, model: '', apiKey: '' })
export function APISettings({ toast }: { toast: (message: string) => void }) {
  const [profiles, setProfiles] = useState<APIProfile[]>([])
  const [draft, setDraft] = useState<APIProfileInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const refresh = async () => { try { setProfiles(await window.zai?.apiProfiles?.() || []) } catch (e) { toast(errorMessage(e)) } }
  useEffect(() => { void refresh() }, [])
  const changed = () => { window.dispatchEvent(new Event('zai-api-profiles')); void refresh() }
  const submit = async () => {
    if (!window.zai?.saveAPIProfile || !draft) { toast('Configura las API en la aplicación de escritorio.'); return }
    setSaving(true); setMessage('')
    try { const p = await window.zai.saveAPIProfile(draft); setDraft(null); changed(); setMessage(p.storage === 'session' ? 'Conexión guardada. La clave durará solo esta sesión: el almacén del sistema no ofrece cifrado seguro.' : 'Conexión guardada. Ya puedes elegirla en una ventana de Zai Agent.'); }
    catch (e) { toast(errorMessage(e)) } finally { setSaving(false) }
  }
  return <section className="custom-settings"><div className="settings-section-title"><KeyRound size={16} /><div><h3>Conexiones de IA</h3><p>Tu proveedor, tu modelo. Zai Agent viene integrado.</p></div><button className="icon-button" aria-label="Añadir conexión API" onClick={() => { setDraft(blank()); setMessage('') }}><Plus size={17} /></button></div>
    <div className="api-profile-list">{profiles.map((p) => <div key={p.id}><Server size={17} /><button onClick={() => { setDraft({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, apiKey: '' }); setMessage('') }}><strong>{p.name}</strong><small>{apiKinds.find((k) => k.value === p.kind)?.label} · {p.storage === 'session' ? 'Clave en esta sesión' : p.hasKey ? 'Clave cifrada' : 'Sin clave'}</small></button><button className="icon-button" aria-label={`Eliminar conexión ${p.name}`} disabled={saving} onClick={async () => { try { await window.zai?.deleteAPIProfile(p.id); if (draft?.id === p.id) setDraft(null); changed() } catch (e) { toast(errorMessage(e)) } }}><Trash2 size={13} /></button></div>)}</div>
    {!profiles.length && !draft && <button className="api-empty" onClick={() => setDraft(blank())}><Plus size={18} /><span>Añadir tu primera conexión<small>DeepSeek, OpenRouter, Ollama y tus motores locales.</small></span></button>}
    {draft && <form className="api-profile-form" onSubmit={(e) => { e.preventDefault(); void submit() }}><div className="agent-field">Proveedor<AgentSelect label="Proveedor de la conexión" value={draft.kind} options={apiKinds} onChange={(kind) => { const k = apiKinds.find((k) => k.value === kind)!; setDraft({ ...draft, kind: k.value, baseUrl: k.url, name: k.label, apiKey: '', clearKey: true }) }} /></div><div className="agent-field-pair"><label className="agent-field">Nombre<input aria-label="Nombre de la conexión" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><label className="agent-field">Modelo preferido<input aria-label="Modelo preferido de la conexión" placeholder="Opcional · ID del modelo" maxLength={200} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label></div><label className="agent-field">Dirección del servidor<input aria-label="Dirección del proveedor" required value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label><label className="agent-field">API key<input aria-label="Clave API" type="password" autoComplete="new-password" spellCheck={false} placeholder={draft.id && profiles.find((p) => p.id === draft.id)?.hasKey ? 'Conservar la clave guardada' : 'Opcional para motores locales'} value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} /></label>{draft.id && <label className="permission-toggle"><input type="checkbox" checked={draft.clearKey || false} onChange={(e) => setDraft({ ...draft, clearKey: e.target.checked })} />Eliminar clave anterior</label>}<p className="provider-note">Las claves se guardan con el cifrado del sistema cuando está disponible. No se incluyen en la pizarra ni en las exportaciones. Cambiar el servidor elimina la clave anterior.</p><div className="settings-form-actions"><button type="button" className="text-button" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Guardar conexión</button></div></form>}
    {message && <p className="provider-note" role="status">{message}</p>}
  </section>
}

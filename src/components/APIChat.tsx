import { errorMessage } from '../errors'
import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Settings2 } from 'lucide-react'
import type { ComponentProps } from 'react'
import type { APIKind, APIProfile, ProviderCatalog } from '../types'
import { AgentChat } from './AgentChat'
import { AgentSelect } from './AgentSelect'
import { chatAPIKinds } from '../api-connections'
export function APIChat(props: Omit<ComponentProps<typeof AgentChat>, 'catalog' | 'catalogLoading' | 'refreshCatalog'> & { settings: (kind?: APIKind) => void }) {
  const [profiles, setProfiles] = useState<APIProfile[]>([])
  const [catalog, setCatalog] = useState<ProviderCatalog>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const sequence = useRef(0)
  const origin = useRef('')
  const busy = ['running', 'starting', 'waiting'].includes(props.runtime.status)
  useEffect(() => {
    const refresh = () => { void window.zai?.apiProfiles?.().then((p) => { setProfiles(p.filter((v) => !['image-api', 'comfyui', 'automatic1111'].includes(v.kind))); setRevision((v) => v + 1) }).catch((e) => setError(errorMessage(e))) }
    refresh(); window.addEventListener('zai-api-profiles', refresh); return () => window.removeEventListener('zai-api-profiles', refresh)
  }, [])
  const selected = profiles.find((p) => p.id === props.panel.connectionId)
  const refresh = async (force = false) => {
    const current = ++sequence.current
    if (!selected || !window.zai?.apiCatalog) { setLoading(false); return }
    setLoading(true); setError('')
    try { const data = await window.zai.apiCatalog(selected.id, props.panel.model, force); if (current === sequence.current) setCatalog(data) } catch (e) { if (current === sequence.current) { setError(errorMessage(e)); setCatalog(undefined) } } finally { if (current === sequence.current) setLoading(false) }
  }
  useEffect(() => { setCatalog(undefined); void refresh() }, [selected?.id, selected?.baseUrl, selected?.model, selected?.hasKey, selected?.kind, props.panel.model, revision])
  useEffect(() => {
    if (!selected) return
    const next = `${selected.id}:${selected.kind}:${selected.baseUrl}`
    if (origin.current && origin.current !== next) props.patch({ sessionId: undefined, context: undefined, messages: [], timeline: [] })
    origin.current = next
  }, [selected?.id, selected?.kind, selected?.baseUrl])
  useEffect(() => { if (selected && props.runtime.status === 'idle') void refresh() }, [props.runtime.status])
  return <div className="api-chat"><div className="api-chat-connection"><AgentSelect label="Conexión de Zai Agent" value={props.panel.connectionId || ''} disabled={busy} options={[...profiles.map((p) => ({ value: p.id, label: p.name, description: chatAPIKinds.find((kind) => kind.value === p.kind)?.label, badge: 'Guardada' })), ...chatAPIKinds.map((kind) => ({ value: `new:${kind.value}`, label: kind.label, description: kind.description, badge: 'Añadir' }))]} onChange={(connectionId) => { if (connectionId.startsWith('new:')) props.settings(connectionId.slice(4) as APIKind); else props.patch({ connectionId, generation: undefined, model: '', effort: '', speed: 'default', sessionId: undefined, context: undefined, messages: [], timeline: [] }) }} /><button className="icon-button" aria-label="Configurar conexiones de IA" title="Conexiones de IA" onClick={() => props.settings()} disabled={busy}><Settings2 size={14} /></button><button className="icon-button" aria-label="Nueva conversación de Zai" title="Nueva conversación · vacía el chat visible" disabled={busy || !props.panel.messages.length} onClick={() => props.patch({ sessionId: undefined, context: undefined, messages: [], timeline: [] })}><RotateCcw size={13} /></button></div>{!selected && <button className="api-chat-note api-chat-setup" onClick={() => props.settings()}>Conecta tu proveedor y añade tu API key para empezar.</button>}{error && <p className="api-chat-note provider-error" role="status">{error}</p>}<AgentChat {...props} catalog={catalog} catalogLoading={loading} refreshCatalog={() => void refresh(true)} send={async (text, submission) => { if (!selected) { throw new Error('Elige una conexión API para Zai Agent.') } await props.send(text, submission) }} /></div>
}

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Folder, LoaderCircle, MessageSquare, ShieldCheck, SlidersHorizontal, Square, X } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRuntime, Approval, Panel, Project, Tool } from '../types'
import { ProviderMark } from './Brand'

function ToolCard({ tool }: { tool: Tool }) {
  return <details className={`tool-card tool-${tool.status}`}><summary>{tool.status === 'running' ? <LoaderCircle className="spin" size={13} /> : tool.status === 'failed' ? <X size={13} /> : <Check size={13} />}<span>{tool.name || 'Herramienta'}</span><code>{tool.detail?.split('\n')[0]?.slice(0, 65)}</code><ChevronDown size={12} /></summary>
    {tool.detail && <pre>{tool.detail}</pre>}{tool.output && <pre className="tool-output">{tool.output}</pre>}</details>
}
function Permission({ approval, panelId, toast }: { approval: Approval; panelId: string; toast: (text: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const respond = async (allow: boolean) => {
    setSending(true)
    try {
      const data = Object.fromEntries((approval.questions || []).map((q) => {
        const key = q.id || q.question
        return [key, approval.kind.includes('UserInput') ? { answers: [answers[key] || ''] } : answers[key] || '']
      }))
      await window.zai?.respond(panelId, approval.requestId, { allow, answers: data })
    } catch (error) { toast(String(error)); setSending(false) }
  }
  const unsupported = approval.kind.includes('elicitation')
  return <div className="permission-card"><div className="permission-title"><ShieldCheck size={16} />{approval.title}</div>
    <pre>{approval.detail}</pre>
    {approval.questions?.map((q) => <label className="permission-question" key={q.id || q.question}>{q.question}
      {q.options && <div className="answer-options">{q.options.map((option) => <button key={option.label} title={option.description} className={answers[q.id || q.question] === option.label ? 'selected' : ''} onClick={() => setAnswers({ ...answers, [q.id || q.question]: option.label })}>{option.label}</button>)}</div>}
      <input aria-label={q.question} value={answers[q.id || q.question] || ''} placeholder="Tu respuesta…" onChange={(e) => setAnswers({ ...answers, [q.id || q.question]: e.target.value })} />
    </label>)}
    {unsupported && <p>Esta solicitud MCP todavía no tiene un formulario compatible en Zai.</p>}
    <div className="permission-actions"><button disabled={sending} onClick={() => respond(false)}>Rechazar</button>{!unsupported && <button className="primary-button" disabled={sending || !!approval.questions?.some((q) => !answers[q.id || q.question]?.trim())} onClick={() => respond(true)}>{approval.questions ? 'Responder' : 'Permitir una vez'}</button>}</div>
  </div>
}
export function AgentChat({ panel, project, runtime, send, patch, chooseFolder, toast }: {
  panel: Panel; project: Project; runtime: AgentRuntime; send: (text: string) => Promise<void>
  patch: (patch: Partial<Panel>) => void; chooseFolder: () => void; toast: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [copied, setCopied] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const busy = ['running', 'starting', 'waiting'].includes(runtime.status)
  const isCodex = panel.kind === 'codex'
  useEffect(() => { if (stickToBottom.current && (panel.messages.length || runtime.tools.length || runtime.approvals.length)) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' }) }, [panel.messages, runtime.tools, runtime.approvals])
  const submit = async () => {
    if (!draft.trim() || busy) return
    const text = draft.trim()
    if (!window.zai) { toast('Abre la app de escritorio para conectar tus agentes locales.'); return }
    if (!project.folder) { chooseFolder(); return }
    setDraft('')
    try { await send(text) } catch { setDraft(text) }
  }
  return <div className="agent-chat">
    <div className="chat-scroll" ref={scroll} onScroll={() => { const el = scroll.current; if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90 }}>
      {!panel.messages.length ? <div className="agent-welcome">
        <span className={`welcome-brand brand-${panel.kind}`}><ProviderMark kind={panel.kind} size={36} /></span>
        <span className="tiny-label">{isCodex ? 'DE LA IDEA AL CÓDIGO' : 'OTRA FORMA DE VERLO'}</span>
        <h2>{isCodex ? '¿Qué construimos hoy?' : 'Las grandes ideas\nempiezan conversando.'}</h2>
        <p>{isCodex ? 'Explora, crea y resuelve. Tu agente ya tiene un lugar en la pizarra.' : 'Un segundo punto de vista para darle forma a lo que tienes en mente.'}</p>
        <div className="suggestion-row">{(isCodex ? [['Explorar proyecto', 'Explora este proyecto y explícame su estructura.'], ['Crear algo nuevo', 'Ayúdame a planificar una nueva funcionalidad para este proyecto.']] : [['Revisar código', 'Revisa el código del proyecto e identifica los problemas más importantes.'], ['Pensar una idea', 'Ayúdame a pensar ideas para mejorar este proyecto.']]).map(([label, text]) => <button key={label} onClick={() => { setDraft(text); input.current?.focus() }}>{label}<ArrowUpRight size={12} /></button>)}</div>
      </div> : <div className="messages">{panel.messages.map((message) => <article key={message.id} className={`message message-${message.role}`}>
        <div className="message-author">{message.role === 'assistant' ? <ProviderMark kind={panel.kind} size={17} /> : <span className="user-dot">T</span>}<span>{message.role === 'assistant' ? panel.title : 'Tú'}</span><time>{new Date(message.time).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</time></div>
        <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={(e) => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) window.zai ? void window.zai.external(href) : window.open(href, '_blank', 'noopener,noreferrer') }}>{children}</a> }}>{message.text}</Markdown></div>
        {message.role === 'assistant' && <button className="copy-message icon-button" aria-label="Copiar respuesta" onClick={async () => { try { await navigator.clipboard.writeText(message.text); setCopied(message.id); setTimeout(() => setCopied(''), 1800) } catch { toast('No se pudo acceder al portapapeles.') } }}>{copied === message.id ? <Check size={13} /> : <Copy size={13} />}</button>}
      </article>)}</div>}
      {runtime.tools.length > 0 && <div className="tool-list">{runtime.tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>}
      {runtime.approvals.map((approval) => <Permission key={approval.requestId} panelId={panel.id} approval={approval} toast={toast} />)}
      {runtime.error && <div className="chat-error"><span>La conexión necesita atención</span><p>{runtime.error}</p></div>}
      {busy && !runtime.approvals.length && <div className="working-indicator"><span /><span /><span /><small>{runtime.status === 'starting' ? `Conectando con ${panel.title}…` : `${panel.title} está trabajando`}</small></div>}
    </div>
    <div className="chat-bottom">
      {modelOpen && <div className="model-settings"><SlidersHorizontal size={14} /><input aria-label={`Modelo de ${panel.title}`} placeholder="Modelo predeterminado del agente" value={panel.model} onChange={(e) => patch({ model: e.target.value })} /><button className="icon-button" onClick={() => setModelOpen(false)} aria-label="Cerrar selector de modelo"><X size={13} /></button></div>}
      <div className={`composer ${busy ? 'busy' : ''}`}><textarea ref={input} rows={2} aria-label={`Mensaje para ${panel.title}`} placeholder={`Pídele a ${panel.title} lo que tienes en mente…`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } }} />
        <div className="composer-toolbar"><span><MessageSquare size={13} />Chat local</span><button className="model-button" title="Cambiar modelo" onClick={() => setModelOpen(!modelOpen)}>{panel.model || 'Predeterminado'}<ChevronDown size={11} /></button>{busy ? <button className="send-button stop-button" title="Detener agente" aria-label={`Detener ${panel.title}`} onClick={() => window.zai?.stop(panel.id).catch((e) => toast(String(e)))}><Square size={12} fill="currentColor" /></button> : <button className="send-button" title="Enviar mensaje" aria-label={`Enviar a ${panel.title}`} disabled={!draft.trim()} onClick={() => void submit()}><ArrowUp size={17} /></button>}</div>
      </div>
      <button className="chat-folder" title={project.folder || 'Vincular carpeta del proyecto'} onClick={chooseFolder}><Folder size={12} /><span>{project.folder ? project.folder.split(/[\\/]/).filter(Boolean).pop() : 'Vincular carpeta del proyecto'}</span><ChevronRight size={11} /></button>
    </div>
  </div>
}

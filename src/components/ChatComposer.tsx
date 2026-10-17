import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ArrowUp, FileText, ImagePlus, LoaderCircle, Paperclip, Square } from 'lucide-react'
import type { AgentRuntime, ChatSubmission, ComposerOptions, ImageAttachment, Panel, Project, Provider } from '../types'
import { ImagePreview, ImageStrip } from './ChatImages'
import { errorMessage } from '../errors'
type Option = { id: string; label: string; description: string; insert: string; file?: string; image?: ImageAttachment }
export const builtInCommands = [
  { name: 'compact', description: 'Resumir el contexto y conservar el historial visible', action: 'compact' },
  { name: 'context', description: 'Ver el tamaño de esta conversación', action: 'context' },
  { name: 'model', description: 'Modelo, esfuerzo y velocidad', action: 'model' },
  { name: 'permissions', description: 'Permisos del agente', action: 'permissions' },
  { name: 'usage', description: 'Límites de cuenta y consumo', action: 'usage' },
  { name: 'stop', description: 'Detener el turno actual', action: 'stop' },
]
function tokenAt(text: string, cursor: number) {
  const before = text.slice(0, cursor), match = before.match(/(?:^|\s)([@/$])([^\s@$]*)$/)
  if (!match || match[1] === '/' && before.slice(0, match.index).trim()) return null
  return { symbol: match[1], query: match[2], start: cursor - match[2].length - 1, end: cursor }
}
const referencesImage = (text: string, reference: string) => new RegExp(`@${reference}(?![a-zA-Z0-9_-])`).test(text)
const referencesFile = (text: string, file: string) => {
  const escaped = (/\s/.test(file) ? JSON.stringify(file) : file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)@${escaped}(?=\\s|$|[,;!?)])`).test(text)
}
export function ChatComposer({ panel, project, runtime, draft, setDraft, input, controls, send, command, chooseFolder, toast }: {
  panel: Panel; project: Project; runtime: AgentRuntime; draft: string; setDraft: (value: string) => void; input: RefObject<HTMLTextAreaElement | null>; controls: ReactNode
  send: (text: string, submission?: ChatSubmission) => Promise<void>; command: (action: string) => void; chooseFolder: () => void; toast: (text: string) => void
}) {
  const [cursor, setCursor] = useState(0), [dismissed, setDismissed] = useState(false), [selected, setSelected] = useState(0)
  const [options, setOptions] = useState<ComposerOptions>({ commands: builtInCommands, skills: [], apps: [] })
  const [files, setFiles] = useState<string[]>([]), [loading, setLoading] = useState(false), [importing, setImporting] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([]), [preview, setPreview] = useState<ImageAttachment>()
  const knownFiles = useRef(new Set<string>()), fileInput = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null)
  const counter = useRef(0), importingRef = useRef(false), id = useId()
  const busy = ['running', 'starting', 'waiting'].includes(runtime.status)
  const history = [...new Map(panel.messages.flatMap((m) => m.attachments || []).map((image) => [image.reference, image])).values()]
  counter.current = Math.max(counter.current, ...history.map((image) => Number(image.reference.slice(6))), 0)
  const token = !dismissed ? tokenAt(draft, cursor) : null
  useEffect(() => {
    if (!token || token.symbol === '@' || !project.folder || !window.zai?.composerOptions) return
    let current = true; setLoading(true)
    void window.zai.composerOptions({ provider: panel.kind as Provider, cwd: project.folder }).then((data) => { if (current) setOptions(data) }).catch((error) => { if (current) setOptions({ commands: builtInCommands, skills: [], apps: [], error: errorMessage(error) }) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [token?.symbol, project.folder, panel.kind])
  useEffect(() => {
    if (token?.symbol !== '@' || !project.folder || !window.zai?.composerFiles) { setFiles([]); return }
    let current = true
    const timer = setTimeout(() => { setLoading(true); void window.zai!.composerFiles(project.folder, token.query).then((data) => { if (current) { setFiles(data); for (const file of data) knownFiles.current.add(file) } }).catch((error) => { if (current) toast(errorMessage(error)) }).finally(() => { if (current) setLoading(false) }) }, 120)
    return () => { current = false; clearTimeout(timer) }
  }, [token?.symbol, token?.query, project.folder])
  const choices: Option[] = !token ? [] : (token.symbol === '/' ? options.commands.map((c) => ({ id: `command:${c.name}`, label: `/${c.name}`, description: c.description || c.argumentHint || 'Comando del agente', insert: `/${c.name}` })) : token.symbol === '$' ? [...options.skills.map((s) => ({ id: `skill:${s.name}`, label: `$${s.name}`, description: s.description || 'Skill disponible en este agente', insert: `$${s.name}` })), ...options.apps.map((a) => ({ id: `app:${a.token}`, label: `$${a.token}`, description: a.description || a.name, insert: `$${a.token}` }))] : [...[...history, ...images].map((image) => ({ id: image.id, label: `@${image.reference}`, description: image.name, insert: `@${image.reference}`, image })), ...files.map((file) => ({ id: file, label: `@${file}`, description: 'Archivo del proyecto', insert: `@${/\s/.test(file) ? JSON.stringify(file) : file}`, file }))]).filter((option) => option.label.toLowerCase().includes(token.query.toLowerCase())).slice(0, 40)
  useEffect(() => { setSelected(0) }, [token?.symbol, token?.query])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const insert = (value: string, start = input.current?.selectionStart ?? draft.length, end = input.current?.selectionEnd ?? start) => {
    const next = draft.slice(0, start) + value + draft.slice(end)
    setDraft(next); setCursor(start + value.length); setDismissed(true)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + value.length, start + value.length) })
  }
  const choose = (option: Option) => { if (token) insert(option.insert + ' ', token.start, token.end) }
  const addFiles = async (files: File[]) => {
    if (importingRef.current) return
    if (!window.zai?.attachImage) { toast('Abre Zai en el escritorio para adjuntar imágenes.'); return }
    if (images.length + files.length > 8) { toast('Puedes adjuntar hasta 8 imágenes por mensaje.'); return }
    importingRef.current = true; setImporting(true)
    try {
      for (const file of files) {
        if (file.size > 5_000_000 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Usa PNG, JPEG, WebP o GIF de hasta 5 MB.')
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file) })
        const image = await window.zai.attachImage({ name: file.name || 'Imagen pegada', dataUrl })
        const reference = `imagen${++counter.current}`
        setImages((old) => [...old, { ...image, reference }])
      }
    } catch (error) { toast(errorMessage(error)) } finally { importingRef.current = false; setImporting(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const submit = async () => {
    if (importing || !draft.trim() && !images.length) return
    if (!window.zai) { toast('Abre la app de escritorio para conectar tus agentes locales.'); return }
    const action = builtInCommands.find((c) => draft.trim() === `/${c.name}`)?.action
    if (action && action !== 'compact') { command(action); setDraft(''); setDismissed(true); return }
    if (busy) return
    if (!project.folder) { chooseFolder(); return }
    if (action === 'compact' && (!panel.sessionId || panel.messages.length < 2)) { toast('Inicia una conversación antes de compactar.'); return }
    const text = draft.trim() || 'Analiza las imágenes adjuntas.'
    const attachments = [...images, ...history.filter((image) => referencesImage(text, image.reference) && !images.some((pending) => pending.id === image.id))]
    const references = [...knownFiles.current].filter((file) => referencesFile(text, file))
    setDraft(''); setImages([]); setDismissed(true)
    try { await send(text, action === 'compact' ? { action: 'compact' } : { attachments, references }) } catch (error) { setDraft(text); setImages(images); toast(errorMessage(error)) }
  }
  const show = token !== null
  return <><div className={`composer ${busy ? 'busy' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)) } }}>
    {show && <div className="composer-suggestions" onPointerDown={(e) => e.preventDefault()}><div className="composer-suggestions-title"><span>{token.symbol === '/' ? 'Comandos' : token.symbol === '$' ? 'Skills y conexiones' : 'Archivos e imágenes'} · {panel.title}</span>{loading && <LoaderCircle size={12} className="spin" />}<kbd>esc</kbd></div><div role="listbox" id={id} ref={list} aria-label={`Opciones de ${panel.title}`}>{choices.map((option, index) => <button key={option.id} id={`${id}-${index}`} type="button" role="option" aria-selected={index === selected} onPointerMove={() => setSelected(index)} onClick={() => choose(option)}>{option.image ? <ImagePlus size={15} /> : token.symbol === '@' ? <FileText size={15} /> : <span className="suggestion-symbol">{token.symbol}</span>}<span><strong>{option.label}</strong><small>{option.description}</small></span><span className="suggestion-enter">↵</span></button>)}</div>{!choices.length && <p>{loading ? 'Consultando opciones…' : !project.folder ? 'Vincula una carpeta para consultar las opciones del agente.' : options.error && token.symbol !== '@' ? options.error : token.symbol === '$' ? 'No hay skills disponibles para esta búsqueda.' : 'No se encontraron opciones.'}</p>}<div className="composer-suggestions-footer">↑ ↓ para elegir <span>Tab o Enter para insertar</span></div></div>}
    {images.length > 0 && <ImageStrip images={images} quote={(image) => insert(`@${image.reference} `)} preview={setPreview} remove={(image) => setImages((old) => old.filter((value) => value.id !== image.id))} />}
    <textarea ref={input} rows={2} role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={show ? id : undefined} aria-activedescendant={show && choices[selected] ? `${id}-${selected}` : undefined} aria-label={`Mensaje para ${panel.title}`} placeholder={`Pídele a ${panel.title} lo que tienes en mente…`} value={draft} onChange={(e) => { setDraft(e.target.value); setCursor(e.target.selectionStart); setDismissed(false) }} onSelect={(e) => setCursor(e.currentTarget.selectionStart)} onPaste={(e) => { const files = Array.from(e.clipboardData.items).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => !!file); if (files.length) { e.preventDefault(); void addFiles(files) } }} onKeyDown={(e) => {
      if (e.nativeEvent.isComposing) return
      if (show && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setSelected((old) => (old + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, choices.length)) % Math.max(1, choices.length)); return }
      if (show && (e.key === 'Tab' || e.key === 'Enter' && !e.shiftKey) && choices[selected]) { e.preventDefault(); choose(choices[selected]); return }
      if (e.key === 'Escape' && show) { e.preventDefault(); e.stopPropagation(); setDismissed(true); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
    }} />
    <div className="composer-tools"><button className="icon-button" title="Adjuntar imágenes · también puedes pegarlas" aria-label={`Adjuntar imágenes a ${panel.title}`} disabled={importing} onClick={() => fileInput.current?.click()}>{importing ? <LoaderCircle size={13} className="spin" /> : <Paperclip size={13} />}</button>{['@', '/', '$'].map((symbol) => <button className="composer-shortcut" key={symbol} aria-label={`${symbol === '@' ? 'Menciones' : symbol === '/' ? 'Comandos' : 'Skills'} de ${panel.title}`} onClick={() => { const start = input.current?.selectionStart ?? draft.length; const prefix = start && !/\s/.test(draft[start - 1]) ? ' ' : ''; insert(prefix + symbol); setDismissed(false) }}>{symbol}</button>)}<span>{importing ? 'Preparando imagen…' : 'Archivos, comandos y skills'}</span><input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label={`Seleccionar imágenes para ${panel.title}`} onChange={(e) => void addFiles(Array.from(e.target.files || []))} /></div>
    <div className="composer-toolbar">{controls}{busy ? <button className="send-button stop-button" title="Detener agente" aria-label={`Detener ${panel.title}`} onClick={() => window.zai?.stop(panel.id).catch((e) => toast(errorMessage(e)))}><Square size={12} fill="currentColor" /></button> : <button className="send-button" title="Enviar mensaje" aria-label={`Enviar a ${panel.title}`} disabled={importing || !draft.trim() && !images.length} onClick={() => void submit()}><ArrowUp size={17} /></button>}</div>
  </div>{preview && <ImagePreview image={preview} close={() => setPreview(undefined)} />}</>
}

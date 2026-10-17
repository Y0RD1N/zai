import { createElement, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Braces, ExternalLink, Globe2, LoaderCircle, LockKeyhole, RotateCw } from 'lucide-react'
import { normalizeUrl } from '../model'
import type { BrowserActivity, Panel } from '../types'

interface Guest extends HTMLElement {
  loadURL(url: string): Promise<void>; getURL(): string; goBack(): void; goForward(): void; reload(): void
  getWebContentsId(): number; canGoBack(): boolean; canGoForward(): boolean; openDevTools(): void
}
export function BrowserPanel({ panel, projectId, patch, toast, onActivity, focus, connectedAgents, activity }: {
  panel: Panel; projectId: string; connectedAgents: string[]; activity?: BrowserActivity; patch: (patch: Partial<Panel>) => void; toast: (text: string) => void
  onActivity: (text: string) => void; focus: () => void
}) {
  const [address, setAddress] = useState(panel.url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState({ back: false, forward: false })
  const guest = useRef<Guest | null>(null)
  const callbacks = useRef({ patch, onActivity, focus })
  callbacks.current = { patch, onActivity, focus }
  const initialUrl = useRef(panel.url)
  const navigate = (value: string) => {
    try { const url = normalizeUrl(value); if (url) { setError(''); patch({ url }); setAddress(url) } }
    catch (e) { toast((e as Error).message) }
  }
  useEffect(() => { setAddress(panel.url) }, [panel.url])
  useEffect(() => {
    if (!panel.url || !window.zai || !guest.current) return
    const el = guest.current
    const update = () => {
      try { const url = el.getURL(); if (/^https?:/.test(url)) { setAddress(url); callbacks.current.patch({ url }); setHistory({ back: el.canGoBack(), forward: el.canGoForward() }) } } catch { /* guest is attaching */ }
    }
    const start = () => { setLoading(true); setError('') }
    const stop = () => { setLoading(false); update() }
    const fail = (e: Event) => {
      const detail = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      if (detail.errorCode !== -3 && detail.isMainFrame !== false) { setLoading(false); setError(detail.errorDescription || 'No se pudo abrir esta dirección.') }
    }
    const title = (e: Event) => { const text = (e as Event & { title: string }).title; if (text) callbacks.current.onActivity(`Navegador · ${text.slice(0, 90)}`) }
    const ready = () => { update(); callbacks.current.focus(); if (window.zai?.registerBrowser) void window.zai.registerBrowser({ id: panel.id, projectId, guestId: el.getWebContentsId() }).catch((error) => toast(String(error))) }
    const listeners: [string, EventListener][] = [['did-start-loading', start], ['did-stop-loading', stop], ['did-navigate', update], ['did-navigate-in-page', update], ['did-fail-load', fail], ['page-title-updated', title], ['dom-ready', ready], ['focus', () => callbacks.current.focus()]]
    for (const [name, fn] of listeners) el.addEventListener(name, fn)
    return () => { for (const [name, fn] of listeners) el.removeEventListener(name, fn) }
  }, [!!panel.url])
  useEffect(() => {
    const el = guest.current
    if (!el || !panel.url) return
    try { if (el.getURL() && el.getURL() !== panel.url) void el.loadURL(panel.url).catch(() => {}) } catch { /* initial URL is loaded by src */ }
  }, [panel.url])
  const refresh = () => {
    setError('')
    if (guest.current) guest.current.reload()
    else { const frame = document.getElementById(`frame-${panel.id}`) as HTMLIFrameElement; if (frame) frame.src = panel.url }
  }
  return <div className="browser-panel"><form className="browser-toolbar" onSubmit={(e) => { e.preventDefault(); navigate(address) }}>
    <button type="button" className="icon-button" title="Atrás" disabled={!history.back} onClick={() => guest.current?.goBack()}><ArrowLeft size={14} /></button>
    <button type="button" className="icon-button" title="Adelante" disabled={!history.forward} onClick={() => guest.current?.goForward()}><ArrowRight size={14} /></button>
    <button type="button" className="icon-button" aria-label="Recargar página" onClick={refresh}>{loading ? <LoaderCircle className="spin" size={14} /> : <RotateCw size={13} />}</button>
    <div className="address-field"><LockKeyhole size={11} /><input aria-label="Dirección del navegador" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="localhost:3000 o cualquier dirección" /><kbd>↵</kbd></div>
    <button type="button" className="icon-button" title="Herramientas de desarrollo" onClick={() => guest.current ? guest.current.openDevTools() : toast('Las herramientas de desarrollo están disponibles en la app de escritorio.')}><Braces size={14} /></button>
    <button type="button" className="icon-button" title="Abrir fuera de Zai" disabled={!panel.url} onClick={() => window.zai ? void window.zai.external(panel.url) : window.open(panel.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={13} /></button>
  </form>
    <div className="browser-surface">
      {panel.url ? window.zai ? createElement('webview', { ref: (el: HTMLElement | null) => { guest.current = el as Guest; if (el && !initialUrl.current) { initialUrl.current = panel.url; el.setAttribute('src', panel.url) } }, src: initialUrl.current || panel.url, partition: `persist:zai-${projectId}-browser`, allowpopups: '', className: 'web-guest' }) : <iframe id={`frame-${panel.id}`} title="Vista previa del navegador" src={panel.url} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" /> : <div className="browser-welcome"><span className="browser-orbit"><Globe2 size={27} strokeWidth={1.2} /><i /><i /></span><h2>Tu idea, en vivo.</h2><p>Abre tu proyecto sin salir de la pizarra.</p><div className="browser-shortcuts"><button onClick={() => navigate('http://localhost:3000')}>localhost:3000<ArrowUpRight size={11} /></button><button onClick={() => navigate('http://localhost:5173')}>localhost:5173<ArrowUpRight size={11} /></button></div></div>}
      {error && <div className="browser-error"><Globe2 size={28} /><h3>No pudimos abrir esta página</h3><p>{error}</p><button className="secondary-button" onClick={refresh}>Volver a intentar</button></div>}
      {loading && <div className="browser-loading" />}
    </div>
    <div className="browser-footer"><i />{loading ? 'Cargando página…' : activity ? `${activity.action} · ${activity.phase === 'started' ? 'En curso' : activity.phase === 'completed' ? 'Completado' : 'Error'}` : connectedAgents.length ? `Conectado con ${connectedAgents.join(' y ')}` : 'Arrastra un punto para conectar un agente'}<span>{window.zai ? 'Chromium' : 'Vista previa web'}</span></div>
  </div>
}

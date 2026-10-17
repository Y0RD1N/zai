import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { FolderOpen, TerminalSquare } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

export function TerminalPanel({ id, folder, chooseFolder }: { id: string; folder: string; chooseFolder: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const bridge = window.zai
    if (!host.current || !bridge || !started || !folder) return
    const term = new Terminal({ fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 13, cursorBlink: true, convertEol: false, theme: { background: '#17191b', foreground: '#d3d5d1', cursor: '#ed987c', selectionBackground: '#ed987c40', black: '#17191b', red: '#e88d89', green: '#a2b797', yellow: '#e3bc75', blue: '#8eb6c5', magenta: '#a6a2cd', cyan: '#80b9b3', white: '#e5e5df' } })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    let disposed = false
    let ready = false
    const queued: string[] = []
    const unsubscribe = bridge.onTerminalData((event) => { if (event.id === id) ready ? term.write(event.data) : queued.push(event.data) })
    const exit = bridge.onTerminalExit((event) => { if (event.id === id) { term.writeln(`\r\n\x1b[90mSesión finalizada (${event.exitCode}).\x1b[0m`); setError('La terminal ha terminado. Puedes cerrar esta ventana y abrir otra.') } })
    const observer = new ResizeObserver(() => {
      if (host.current && host.current.clientWidth > 10) { fit.fit(); if (ready) void bridge.resizeTerminal(id, term.cols, term.rows) }
    })
    observer.observe(host.current)
    fit.fit()
    bridge.startTerminal({ id, cwd: folder, cols: term.cols, rows: term.rows }).then(({ buffer }) => {
      if (disposed) return
      term.write(buffer)
      for (const data of queued) term.write(data)
      ready = true
      term.focus()
    }).catch((e) => { if (!disposed) setError(String(e)) })
    const onData = term.onData((data) => { if (ready) void bridge.writeTerminal(id, data) })
    return () => { disposed = true; observer.disconnect(); unsubscribe(); exit(); onData.dispose(); term.dispose() }
  }, [id, folder, started])
  if (!started) return <div className="terminal-welcome"><TerminalSquare size={32} strokeWidth={1.2} /><h2>Tu terminal, a mano.</h2><p>Ejecuta comandos en la carpeta de este proyecto.</p><button className="secondary-button" onClick={() => { if (!window.zai) { setError('Disponible en la app de escritorio.'); return } if (!folder) { chooseFolder(); return } setStarted(true) }}>{folder ? <TerminalSquare size={14} /> : <FolderOpen size={14} />}{folder ? 'Iniciar terminal' : 'Vincular carpeta'}</button>{error && <p className="inline-error">{error}</p>}</div>
  return <div className="terminal-panel"><div className="terminal-host" ref={host} />{error && <div className="terminal-error">{error}</div>}</div>
}

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface SelectOption { value: string; label: string; description?: string; badge?: string; disabled?: boolean }
export function AgentSelect({ label, value, options, onChange, disabled = false, searchable = false }: {
  label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; searchable?: boolean
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 0, top: 0, width: 240, maxHeight: 320 })
  const filtered = options.filter((option) => `${option.label} ${option.description || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const current = options.find((option) => option.value === value)
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus() }
  const locate = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(Math.max(rect.width, searchable ? 310 : 245), window.innerWidth - 24)
    const desired = Math.min(390, options.length * 60 + (searchable ? 104 : 88))
    const above = rect.top - 12, below = window.innerHeight - rect.bottom - 12
    const flip = below < Math.min(220, desired) && above > below
    const maxHeight = Math.max(100, Math.min(desired, flip ? above - 7 : below - 7))
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), ...(flip ? { bottom: window.innerHeight - rect.top + 7 } : { top: rect.bottom + 7 }), width, maxHeight })
  }
  const show = () => {
    if (disabled) return
    const selected = options.findIndex((option) => option.value === value && !option.disabled)
    locate(); setQuery(''); setActive(Math.max(0, selected < 0 ? options.findIndex((option) => !option.disabled) : selected)); setOpen(true)
  }
  const choose = (option?: SelectOption) => { if (option && !option.disabled) { onChange(option.value); close(true) } }
  useLayoutEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!popup.current?.contains(target) && !trigger.current?.contains(target)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } }
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) locate() }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true); document.addEventListener('scroll', scroll, true); window.addEventListener('resize', locate)
    if (searchable) search.current?.focus(); else list.current?.focus()
    const frame = requestAnimationFrame(() => popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', locate); cancelAnimationFrame(frame) }
  }, [open])
  const move = (direction: number) => {
    if (!filtered.length) return
    let next = active
    for (let count = 0; count < filtered.length; count++) { next = (next + direction + filtered.length) % filtered.length; if (!filtered[next].disabled) break }
    setActive(next)
    popup.current?.querySelector(`#${CSS.escape(`${id}-${next}`)}`)?.scrollIntoView({ block: 'nearest' })
  }
  return <>
    <button ref={trigger} type="button" className={`agent-select-trigger ${open ? 'select-open' : ''}`} role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} data-value={value} disabled={disabled}
      onClick={() => open ? close() : show()} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); if (!open) show() } }}><span>{current?.label || value || 'Elegir…'}</span><ChevronDown size={13} /></button>
    {open && createPortal(<div className="agent-select-popover" ref={popup} style={position} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1) }
      else if (event.key === 'Enter' || (event.key === ' ' && event.target === list.current)) { event.preventDefault(); choose(filtered[active]) }
      else if (event.key === 'Home' && event.target === list.current) { event.preventDefault(); setActive(0) }
      else if (event.key === 'End' && event.target === list.current) { event.preventDefault(); setActive(filtered.length - 1) }
      else if (event.key === 'Tab') close(true)
      else if (event.key.length === 1 && !searchable && !event.ctrlKey && !event.metaKey) { const index = filtered.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())); if (index >= 0) setActive(index) }
      event.stopPropagation()
    }}>
      {searchable ? <div className="agent-select-search"><Search size={14} /><input ref={search} aria-label={`Buscar opciones de ${label}`} aria-controls={`${id}-list`} aria-autocomplete="list" placeholder="Buscar un modelo…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} /><kbd>Esc</kbd></div> : <div className="agent-select-caption"><span>{label}</span><kbd>Esc</kbd></div>}
      <div className="agent-select-list" ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={`Opciones de ${label}`} aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}>
        {filtered.map((option, index) => <button type="button" key={option.value} id={`${id}-${index}`} role="option" tabIndex={-1} aria-label={option.label} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-value={option.value}
          className={`agent-select-option ${index === active ? 'option-active' : ''} ${option.value === value ? 'option-selected' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
          <span className="select-option-mark">{option.value === value ? <Check size={13} /> : <i />}</span><span className="select-option-content"><strong>{option.label}{option.badge && <small>{option.badge}</small>}</strong>{option.description && <span>{option.description}</span>}</span>
        </button>)}
        {!filtered.length && <p className="agent-select-empty">No encontramos ese modelo.</p>}
      </div>
      <div className="agent-select-footnote">↑ ↓ para recorrer<span>↵ para elegir</span></div>
    </div>, document.body)}
  </>
}

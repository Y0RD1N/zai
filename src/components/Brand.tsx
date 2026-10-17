import { Globe2, StickyNote, TerminalSquare } from 'lucide-react'
import type { PanelKind } from '../types'

export function ZaiMark({ size = 27 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="10" fill="currentColor" /><path d="M10 10.5h13L10 21.5h13" stroke="var(--mark-ink, #211d19)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
export function ProviderMark({ kind, size = 24 }: { kind: PanelKind; size?: number }) {
  if (kind === 'codex') return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m12 9-8 7 8 7M20 9l8 7-8 7M18 6l-4 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (kind === 'claude') return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M16 3v9" transform={`rotate(${i * 30} 16 16)`} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />)}</svg>
  if (kind === 'browser') return <Globe2 size={size} strokeWidth={1.6} />
  if (kind === 'terminal') return <TerminalSquare size={size} strokeWidth={1.6} />
  return <StickyNote size={size} strokeWidth={1.6} />
}

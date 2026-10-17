import type { AgentModel, GenerationOptions, Panel } from '../types'

export function APIGenerationControls({ panel, model, busy, patch }: {
  panel: Panel; model?: AgentModel; busy: boolean; patch: (value: Partial<Panel>) => void
}) {
  const generation = panel.generation || {}
  const limit = Math.min(model?.maxOutputTokens || 1_000_000, 1_000_000)
  const change = (key: keyof GenerationOptions, raw: string) => {
    const value = raw === '' ? undefined : Number(raw)
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) return
    patch({ generation: { ...generation, [key]: value === undefined ? undefined : Math.min(value, limit) }, ...(key === 'reasoningBudget' && value !== undefined ? { effort: '' } : {}) })
  }
  return <>
    {model?.contextWindow && <p className="provider-note model-limits">Contexto: {model.contextWindow.toLocaleString('es')} tokens{model.maxOutputTokens ? ` · Salida máxima: ${model.maxOutputTokens.toLocaleString('es')}` : ''}</p>}
    <details className="api-generation-options" open={generation.maxOutputTokens !== undefined || generation.reasoningBudget !== undefined || undefined}>
      <summary>Más opciones de generación</summary>
      <div className="agent-field-pair">
        <label className="agent-field">Límite de salida<input aria-label={`Límite de salida de ${panel.title}`} type="number" min={1} max={limit} step={1} disabled={busy} placeholder="Automático" value={generation.maxOutputTokens ?? ''} onChange={(e) => change('maxOutputTokens', e.target.value)} /></label>
        {model?.reasoningBudget && <label className="agent-field">Tokens de razonamiento<input aria-label={`Presupuesto de razonamiento de ${panel.title}`} type="number" min={1} max={Math.max(1, (generation.maxOutputTokens || limit) - 1)} step={1} disabled={busy} placeholder="Automático" value={generation.reasoningBudget ?? ''} onChange={(e) => change('reasoningBudget', e.target.value)} /></label>}
      </div>
      <p className="provider-note">El límite incluye los tokens de razonamiento y de respuesta.{model?.reasoningBudget ? ' Si fijas un presupuesto de razonamiento, define un límite de salida mayor. Este presupuesto reemplaza el nivel de esfuerzo.' : ''} Deja vacío para usar los valores del proveedor.</p>
    </details>
  </>
}

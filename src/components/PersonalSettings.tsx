import { APISettings } from './APISettings'
import { BackgroundSettings } from './BackgroundSettings'
import { GraphicsSettings } from './GraphicsSettings'
import type { CanvasBackground, BackgroundChange } from '../types'
export function PersonalSettings({ background, change, toast }: { background?: CanvasBackground; change: BackgroundChange; toast: (text: string) => void }) {
  return <><GraphicsSettings toast={toast} /><BackgroundSettings value={background} change={change} toast={toast} /><APISettings toast={toast} /></>
}

import type { APIKind, APIProfileInput } from './types'

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

export const chatAPIKinds = apiKinds.filter((kind) => !['image-api', 'comfyui', 'automatic1111'].includes(kind.value))
export function newAPIProfile(kind: APIKind = 'deepseek'): APIProfileInput {
  const preset = apiKinds.find((preset) => preset.value === kind)!
  return { name: preset.label, kind, baseUrl: preset.url, model: '', apiKey: '' }
}

// Explicit protocol probes: no prompt is sent and no model inference is requested.
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { query } from '@anthropic-ai/claude-agent-sdk'
const require = createRequire(import.meta.url)
const { findExecutable, launch } = require('../electron/agents.cjs')
const timeout = (promise, label) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: tiempo agotado`)), 25_000) })]).finally(() => clearTimeout(timer))
}

const codex = findExecutable('codex')
if (codex) {
  const child = launch(codex, ['app-server'], process.cwd())
  try {
    await timeout(new Promise((resolve, reject) => {
      child.once('error', reject)
      const lines = createInterface({ input: child.stdout })
      child.stderr.resume()
      lines.on('line', (line) => {
        try { const frame = JSON.parse(line); if (frame.id === 1) frame.error ? reject(new Error(frame.error.message)) : resolve(frame.result) } catch { /* non-protocol output is ignored by this probe */ }
      })
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'zai_probe', title: 'Zai protocol test', version: '0.1.0' } } }) + '\n')
    }), 'Codex')
    console.log('✓ Codex: App Server responde al protocolo de inicialización')
  } finally { child.kill() }
} else console.log('— Codex CLI no está instalado')

const claude = findExecutable('claude')
if (claude) {
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const prompt = (async function* () { await wait })()
  const stream = query({ prompt, options: { pathToClaudeCodeExecutable: claude, settingSources: [], permissionMode: 'default' } })
  try {
    await timeout(stream.initializationResult(), 'Claude')
    console.log('✓ Claude: el Agent SDK inicia Claude Code y completa el protocolo de control')
  } finally { release(); stream.close() }
} else console.log('— Claude Code no está instalado')

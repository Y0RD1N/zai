const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const schema = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } })
const str = { type: 'string' }, num = { type: 'integer' }
const definitions = [
  schema('read_file', 'Read a UTF-8 file inside the linked project, with optional line range.', { path: str, start: num, end: num }, ['path']),
  schema('list_files', 'List paths inside project. Excludes .git, node_modules and build caches. At most 1200 entries.', { path: str }, []),
  schema('search_text', 'Find literal text in project files; optional relative directory. Returns line numbers.', { text: str, path: str }, ['text']),
  schema('write_file', 'Create or replace a UTF-8 file inside the project. Requires permission.', { path: str, content: str }, ['path', 'content']),
  schema('edit_file', 'Replace one exact unique occurrence. Fails if text is missing or ambiguous.', { path: str, old_text: str, new_text: str }, ['path', 'old_text', 'new_text']),
  schema('run_command', 'Run a shell command with project cwd. Requires approval except autonomous mode. The shell has user access, not an OS sandbox. Timeout <=120s.', { command: str, timeout: num }, ['command']),
  schema('update_plan', 'Save a plan and progress for this task.', { steps: { type: 'array', maxItems: 30, items: { type: 'object', properties: { text: str, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['text', 'status'], additionalProperties: false } } }, ['steps']),
  schema('use_skill', 'Read instructions of an available SKILL.md by exact name. Does not execute code.', { name: str }, ['name']),
  schema('ask_user', 'Ask the user a question and wait for a text answer.', { question: str }, ['question']),
  schema('delegate_review', 'Ask an isolated read-only subagent to investigate a concrete question. Same model, no writes/commands/browser control, at most 8 tool rounds.', { task: str }, ['task']),
]
const skipped = new Set(['.git', 'node_modules', '.next', '.cache', 'dist', 'release', 'target', '.venv'])
async function projectPath(cwd, value, writing = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 4000) throw new Error('Ruta inválida.')
  const root = await fs.realpath(cwd), dest = path.resolve(root, value || '.')
  const within = (p) => p === root || p.startsWith(root + path.sep)
  if (!within(dest) || dest.split(path.sep).includes('.git') && writing) throw new Error('La ruta debe estar dentro del proyecto y fuera de .git.')
  let ancestor = dest
  while (true) { try { if (!within(await fs.realpath(ancestor))) throw new Error('La ruta atraviesa un enlace fuera del proyecto.'); break } catch (e) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(ancestor); if (parent === ancestor) throw e; ancestor = parent } }
  return dest
}
async function files(root, signal) {
  const result = []; let scanned = 0
  async function walk(dir) {
    if (signal?.aborted) throw new Error('Interrumpido.')
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (++scanned > 5000 || result.length >= 1200) return
      if (skipped.has(e.name) || e.isSymbolicLink()) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) result.push(full)
    }
  }
  await walk(root); return result
}
async function skills(cwd) {
  const result = []
  for (const base of [path.join(cwd, '.agents/skills'), path.join(cwd, '.claude/skills'), path.join(os.homedir(), '.agents/skills'), path.join(os.homedir(), '.claude/skills')]) {
    let dirs; try { dirs = await fs.readdir(base, { withFileTypes: true }) } catch { continue }
    for (const dir of dirs.slice(0, 100)) {
      if (!dir.isDirectory()) continue
      const file = path.join(base, dir.name, 'SKILL.md')
      try { const stat = await fs.stat(file); if (stat.size > 150_000) continue; const content = await fs.readFile(file, 'utf8'); if (!result.some((v) => v.name === dir.name)) result.push({ name: dir.name, file, description: content.match(/^description:\s*(.*)$/m)?.[1]?.slice(0, 350) || content.split('\n').find((v) => v && !v.startsWith('---'))?.slice(0, 150) || '', content }) } catch { /* optional */ }
    }
  }
  return result
}
async function instructions(cwd) {
  const result = []
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.zai/instructions.md']) {
    try { const file = await projectPath(cwd, name); const stat = await fs.stat(file); if (stat.size <= 100_000) result.push(`${name}:\n${await fs.readFile(file, 'utf8')}`) } catch { /* optional */ }
  }
  return result.join('\n\n').slice(0, 30_000)
}
async function runCommand(command, cwd, timeout, signal) {
  if (typeof command !== 'string' || !command.trim() || command.length > 20_000) throw new Error('Comando inválido.')
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || '/bin/sh'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]
    // Explicit credentials and Electron's Node mode are never inherited by child tools.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API.?KEY|TOKEN|SECRET|PASSWORD|ELECTRON_RUN_AS_NODE/i.test(key)))
    const child = spawn(executable, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' })
    let output = '', stopped = false
    const stop = () => { stopped = true; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill()); else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
    const timer = setTimeout(stop, Math.max(1000, Math.min(120_000, Number(timeout) || 60_000)))
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
    child.stdout.on('data', (data) => { output = (output + data).slice(-40_000) }); child.stderr.on('data', (data) => { output = (output + data).slice(-40_000) })
    child.on('error', (e) => { cleanup(); reject(e) }); child.on('close', (code) => { cleanup(); resolve(`Exit ${code}${stopped ? ' (interrumpido o tiempo agotado)' : ''}\n${output}`) })
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop()
  })
}
async function performTool(name, args, context) {
  const { signal, availableSkills, checkpoint } = context
  const cwd = await fs.realpath(context.cwd)
  if (name === 'use_skill') { const skill = availableSkills.find((s) => s.name === args.name); if (!skill) throw new Error('Skill no encontrada.'); return skill.content }
  if (name === 'run_command') return runCommand(args.command, cwd, args.timeout, signal)
  if (name === 'update_plan') { if (!Array.isArray(args.steps) || args.steps.length > 30 || args.steps.some((s) => typeof s.text !== 'string' || !['pending', 'in_progress', 'completed'].includes(s.status))) throw new Error('Plan inválido.'); return JSON.stringify(args.steps) }
  const file = await projectPath(cwd, args.path || '.', ['write_file', 'edit_file'].includes(name))
  if (name === 'list_files') return (await files(file, signal)).map((v) => path.relative(cwd, v)).join('\n')
  if (name === 'search_text') {
    if (typeof args.text !== 'string' || !args.text || args.text.length > 1000) throw new Error('Texto de búsqueda inválido.')
    const matches = []
    for (const entry of await files(file, signal)) { try { const stat = await fs.stat(entry); if (stat.size > 500_000) continue; const text = await fs.readFile(entry, 'utf8'); if (text.includes('\0')) continue; for (const [i, line] of text.split('\n').entries()) if (line.includes(args.text)) { matches.push(`${path.relative(cwd, entry)}:${i + 1}: ${line.slice(0, 600)}`); if (matches.length >= 120) return matches.join('\n') } } catch { /* unreadable */ } }
    return matches.join('\n') || 'Sin coincidencias.'
  }
  if (name === 'read_file') { const stat = await fs.stat(file); if (stat.size > 2_000_000) throw new Error('El archivo supera 2 MB.'); const text = await fs.readFile(file, 'utf8'); if (text.includes('\0')) throw new Error('Archivo binario.'); const start = Math.max(1, args.start || 1), end = Math.min(start + 599, args.end || start + 299); return text.split('\n').slice(start - 1, end).map((v, i) => `${i + start}: ${v}`).join('\n').slice(0, 40_000) }
  if (['write_file', 'edit_file'].includes(name)) {
    let previous = null
    try { const stat = await fs.stat(file); if (stat.size > 2_000_000) throw new Error('El archivo supera 2 MB.'); previous = await fs.readFile(file, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    let content = args.content
    if (name === 'edit_file') { if (previous === null || typeof args.old_text !== 'string' || !args.old_text || typeof args.new_text !== 'string' || previous.split(args.old_text).length !== 2) throw new Error('El texto original debe aparecer exactamente una vez.'); content = previous.replace(args.old_text, args.new_text) }
    if (typeof content !== 'string' || content.length > 2_000_000) throw new Error('Contenido inválido o demasiado grande.')
    await checkpoint(path.relative(cwd, file), previous)
    if (signal.aborted) throw new Error('Interrumpido.')
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content, 'utf8'); return `Guardado: ${path.relative(cwd, file)} (${content.length} caracteres). Respaldo anterior conservado en la sesión.`
  }
  throw new Error('Herramienta no disponible.')
}
module.exports = { definitions, projectPath, skills, instructions, performTool }
// Enforce the schemas locally; tool arguments from a model are untrusted input.
function validateArguments(schema, value, label = 'argumentos') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: se esperaba un objeto.`)
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${label}: falta ${key}.`)
    for (const [key, item] of Object.entries(value)) { if (!schema.properties?.[key]) { if (schema.additionalProperties === false) throw new Error(`${label}: campo no permitido ${key}.`) } else validateArguments(schema.properties[key], item, key) }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems || 1000)) throw new Error(`${label}: lista inválida.`)
    for (const item of value) validateArguments(schema.items, item, label)
  } else if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error(`${label}: tipo inválido.`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${label}: valor no permitido.`)
}
module.exports.validateArguments = validateArguments

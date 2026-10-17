const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const kinds = ['deepseek', 'openrouter', 'ollama-cloud', 'ollama-local', 'compatible', 'image-api', 'automatic1111', 'comfyui']
function endpoint(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('La dirección del proveedor no es válida.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Usa una dirección HTTP(S) sin credenciales ni parámetros.')
  const host = url.hostname
  const ipv4 = require('node:net').isIP(host) === 4 ? host.split('.').map(Number) : null
  const local = host === 'localhost' || host === '[::1]' || ipv4 && (ipv4[0] === 127 || ipv4[0] === 10 || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
  if (url.protocol !== 'https:' && !local) throw new Error('Usa HTTPS para proveedores remotos. HTTP solo está permitido para motores locales o de tu red.')
  return url.href.replace(/\/$/, '')
}
function createAPIProfiles({ directory, safeStorage, platform = process.platform }) {
  let profiles, loading, writing = Promise.resolve()
  const memory = new Map()
  const secure = () => { try { return safeStorage.isEncryptionAvailable() && (platform !== 'linux' || typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() !== 'basic_text') } catch { return false } }
  async function load() {
    if (!profiles && !loading) loading = (async () => {
      try { const data = JSON.parse(await fs.readFile(path.join(directory, 'api-profiles.json'), 'utf8')); profiles = Array.isArray(data) ? data : [] }
      catch (e) { if (e.code !== 'ENOENT') throw new Error('No se pudieron leer las conexiones API.'); profiles = [] }
    })()
    if (loading) await loading
    return profiles
  }
  const view = (p) => ({ id: p.id, kind: p.kind, name: p.name, baseUrl: p.baseUrl, model: p.model, hasKey: !!(p.secret || memory.get(p.id)), storage: p.secret ? 'encrypted' : memory.has(p.id) ? 'session' : 'none' })
  const persist = async () => { await fs.mkdir(directory, { recursive: true }); const file = path.join(directory, 'api-profiles.json'); await fs.writeFile(file + '.tmp', JSON.stringify(profiles), { mode: 0o600 }); await fs.rename(file + '.tmp', file) }
  const serial = (fn) => { const result = writing.catch(() => {}).then(fn); writing = result; return result }
  return {
    async list() { return (await load()).map(view) },
    save(value) { return serial(async () => {
      await load()
      if (!value || !kinds.includes(value.kind) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.model !== 'string' || value.model.length > 200 || value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 8192)) throw new Error('Configuración de conexión inválida.')
      const previous = profiles.find((p) => p.id === value.id)
      if (value.id && !previous) throw new Error('La conexión ya no existe.')
      if (!previous && profiles.length >= 100) throw new Error('Límite de conexiones alcanzado.')
      const p = { ...previous, id: previous?.id || randomUUID(), name: value.name.trim(), kind: value.kind, baseUrl: endpoint(value.baseUrl), model: value.model.trim() }
      // A key never silently follows a change of destination/provider.
      if (value.clearKey || previous && (p.baseUrl !== previous.baseUrl || p.kind !== previous.kind)) { delete p.secret; memory.delete(p.id) }
      if (value.apiKey?.trim()) {
        let cipher
        if (secure()) { try { cipher = safeStorage.encryptString(value.apiKey.trim()).toString('base64') } catch { /* locked keychain: session-only fallback */ } }
        if (cipher) { p.secret = cipher; memory.delete(p.id) }
        else { delete p.secret; memory.set(p.id, value.apiKey.trim()) }
      }
      profiles = previous ? profiles.map((old) => old.id === p.id ? p : old) : [...profiles, p]
      await persist(); return view(p)
    }) },
    delete(id) { return serial(async () => { await load(); profiles = profiles.filter((p) => p.id !== id); memory.delete(id); await persist() }) },
    async get(id) {
      const p = (await load()).find((p) => p.id === id)
      if (!p) throw new Error('Selecciona una conexión API en las preferencias de Zai.')
      let apiKey = memory.get(id) || ''
      if (p.secret) { try { apiKey = safeStorage.decryptString(Buffer.from(p.secret, 'base64')) } catch { throw new Error('El almacén del sistema no pudo abrir esta clave. Vuelve a guardarla en Preferencias.') } }
      if (!apiKey && ['deepseek', 'openrouter', 'ollama-cloud', 'image-api'].includes(p.kind)) throw new Error('Agrega la API key de esta conexión en Preferencias.')
      return { ...view(p), apiKey }
    },
    dispose() { memory.clear() },
  }
}
module.exports = { createAPIProfiles, endpoint }

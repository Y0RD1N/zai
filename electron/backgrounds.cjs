const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { json, request, readBuffer } = require('./api-client.cjs')
const pause = (ms, signal) => new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(new Error('Generación cancelada.')) }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort() })
function createBackgrounds({ directory, nativeImage, profiles }) {
  let active
  async function store(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length > 32_000_000 || buffer.length < 8) throw new Error('La imagen debe pesar menos de 32 MB.')
    const magic = buffer.subarray(0, 16)
    if (!(magic.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || magic[0] === 255 && magic[1] === 216 || magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP' || magic.toString('ascii', 0, 3) === 'GIF')) throw new Error('Usa una imagen PNG, JPEG, WebP o GIF. No se admiten SVG ni archivos ejecutables.')
    if (magic[0] === 137 && buffer.length >= 24 && buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 80_000_000) throw new Error('La imagen tiene demasiados píxeles.')
    let image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error('No se pudo abrir la imagen.')
    const size = image.getSize()
    if (size.width * size.height > 80_000_000) throw new Error('La imagen tiene demasiados píxeles.')
    if (Math.max(size.width, size.height) > 4096) image = image.resize(size.width >= size.height ? { width: 4096, quality: 'best' } : { height: 4096, quality: 'best' })
    await fs.mkdir(directory, { recursive: true }); const id = randomUUID(); await fs.writeFile(path.join(directory, id + '.png'), image.toPNG(), { mode: 0o600 }); return id
  }
  return {
    async import(file) { const stat = await fs.stat(file); if (stat.size > 32_000_000) throw new Error('La imagen supera 32 MB.'); return store(await fs.readFile(file)) },
    async read(id) { if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('Imagen inválida.'); return fs.readFile(path.join(directory, id + '.png')) },
    cancel() { active?.abort() },
    async generate(input) {
      if (active) throw new Error('Ya hay un fondo generándose.')
      if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 10_000 || typeof input.model !== 'string' || input.model.length > 200) throw new Error('Escribe una descripción y un modelo de imagen válidos.')
      const abort = new AbortController(); active = abort
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60_000)])
      try {
        const p = await profiles.get(input.profileId)
        let base64
        if (p.kind === 'openrouter') {
          const data = await json(p, '/images', { model: input.model, prompt: input.prompt, n: 1 }, signal, 10 * 60_000); base64 = data.data?.[0]?.b64_json
        } else if (p.kind === 'image-api') {
          const data = await json(p, '/images/generations', { model: input.model, prompt: input.prompt, n: 1, size: '1536x1024' }, signal, 10 * 60_000)
          base64 = data.data?.[0]?.b64_json
          if (!base64 && data.data?.[0]?.url) {
            // Temporary signed image URLs are fetched without the provider API key.
            const url = new URL(data.data[0].url); if (url.protocol !== 'https:') throw new Error('El proveedor devolvió una imagen sin HTTPS.')
            const response = await fetch(url, { signal, redirect: 'error' }); if (!response.ok || Number(response.headers.get('content-length')) > 32_000_000) throw new Error('No se pudo descargar la imagen generada.')
            return await store(await readBuffer(response))
          }
        } else if (p.kind === 'automatic1111') {
          const data = await json(p, '/sdapi/v1/txt2img', { prompt: input.prompt, width: 1024, height: 576, steps: 24, batch_size: 1 }, signal, 10 * 60_000); base64 = data.images?.[0]
        } else if (p.kind === 'comfyui') {
          if (typeof input.workflow !== 'string' || input.workflow.length > 2_000_000 || !input.workflow.includes('{{prompt}}')) throw new Error('Pega un workflow de ComfyUI en formato API con {{prompt}} en el texto positivo.')
          let workflow
          try { workflow = JSON.parse(input.workflow.replaceAll('{{prompt}}', JSON.stringify(input.prompt).slice(1, -1))) } catch { throw new Error('El workflow no es JSON válido.') }
          if (!workflow || Array.isArray(workflow) || typeof workflow !== 'object' || Object.values(workflow).some((v) => !v || typeof v.class_type !== 'string' || !v.inputs)) throw new Error('Exporta el workflow en formato API (nodos con class_type e inputs).')
          const queued = await json(p, '/prompt', { prompt: workflow, client_id: randomUUID() }, signal)
          if (!queued.prompt_id || queued.node_errors && Object.keys(queued.node_errors).length) throw new Error('ComfyUI rechazó el workflow; revisa sus modelos y nodos instalados.')
          while (true) {
            await pause(1200, signal)
            const history = await json(p, `/history/${encodeURIComponent(queued.prompt_id)}`, undefined, signal)
            const run = history[queued.prompt_id]
            if (run?.status?.status_str === 'error') throw new Error('ComfyUI no pudo completar el workflow.')
            const img = Object.values(run?.outputs || {}).flatMap((v) => v.images || [])[0]
            if (img) { const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' }); const response = await request(p, `/view?${q}`, undefined, signal); return await store(await readBuffer(response)) }
            if (run?.status?.completed) throw new Error('El workflow terminó sin una imagen guardada.')
          }
        } else throw new Error('Usa OpenRouter, una API de imágenes, Automatic1111/Forge o ComfyUI para generar fondos.')
        if (typeof base64 !== 'string' || base64.length > 44_000_000) throw new Error('El motor no devolvió una imagen base64 válida.')
        signal.throwIfAborted(); return await store(Buffer.from(base64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64'))
      } finally { active = undefined }
    },
  }
}
module.exports = { createBackgrounds }

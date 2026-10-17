const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
function createAttachments({ directory, nativeImage }) {
  async function read(id) {
    if (typeof id !== 'string' || !/^[a-f\d-]{36}\.png$/i.test(id)) throw new Error('Imagen inválida.')
    const file = path.join(directory, id), stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size > 5_000_000 || !stat.size) throw new Error('Imagen no disponible.')
    return fs.readFile(file)
  }
  return {
    read,
    async import({ name, dataUrl } = {}) {
      if (typeof dataUrl !== 'string' || dataUrl.length > 7_000_000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z\d+/=]+$/.test(dataUrl)) throw new Error('Usa una imagen PNG, JPEG, WebP o GIF de hasta 5 MB.')
      const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      if (buffer.length > 5_000_000) throw new Error('La imagen supera 5 MB.')
      const image = nativeImage.createFromBuffer(buffer), { width, height } = image.getSize()
      if (image.isEmpty() || !width || !height || width * height > 25_000_000) throw new Error('La imagen está dañada o supera 25 megapíxeles.')
      const png = image.toPNG()
      if (png.length > 5_000_000) throw new Error('La imagen decodificada supera 5 MB. Reduce sus dimensiones.')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const id = `${randomUUID()}.png`
      await fs.writeFile(path.join(directory, id), png, { mode: 0o600, flag: 'wx' })
      return { id, name: String(name || 'Imagen pegada').replace(/[\x00-\x1f]/g, '').slice(0, 180), width, height, bytes: png.length, mimeType: 'image/png' }
    },
    async resolve(items = []) {
      if (!Array.isArray(items) || items.length > 8) throw new Error('Adjunta un máximo de 8 imágenes por mensaje.')
      const result = []; let size = 0
      for (const item of items) {
        if (!item || !/^imagen[1-9]\d{0,5}$/.test(item.reference)) throw new Error('Referencia de imagen inválida.')
        const data = await read(item.id); size += data.length
        if (size > 20_000_000) throw new Error('Las imágenes del mensaje superan 20 MB.')
        result.push({ id: item.id, reference: item.reference, name: String(item.name || item.reference).slice(0, 180), path: path.join(directory, item.id), mimeType: 'image/png', data: data.toString('base64') })
      }
      if (new Set(result.map((item) => item.reference)).size !== result.length) throw new Error('Hay referencias de imagen repetidas.')
      return result
    },
  }
}
const imageLabel = (image) => `Imagen ${image.reference.slice(6)} (@${image.reference}) · ${image.name}`
function codexInput(text, images = [], skills = [], apps = []) {
  return [{ type: 'text', text, text_elements: [] }, ...images.flatMap((image) => [{ type: 'text', text: imageLabel(image), text_elements: [] }, { type: 'localImage', path: image.path }]), ...skills.map(({ name, path }) => ({ type: 'skill', name, path })), ...apps.map(({ name, path }) => ({ type: 'mention', name, path }))]
}
function claudeContent(text, images = []) {
  return images.length ? [{ type: 'text', text }, ...images.flatMap((image) => [{ type: 'text', text: imageLabel(image) }, { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }])] : text
}
async function materializeMessages(messages, p, attachments) {
  const native = ['ollama-local', 'ollama-cloud'].includes(p.kind)
  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content) || !message.content.some((item) => item.type === 'zai_image')) return message
    const content = [], images = []
    for (const item of message.content) {
      if (item.type !== 'zai_image') { content.push(item); continue }
      const data = (await attachments.read(item.id)).toString('base64')
      content.push({ type: 'text', text: imageLabel(item) })
      if (native) images.push(data)
      else content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } })
    }
    return native ? { ...message, content: content.filter((item) => item.type === 'text').map((item) => item.text).join('\n'), images } : { ...message, content }
  }))
}
module.exports = { createAttachments, codexInput, claudeContent, materializeMessages }

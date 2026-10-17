const { textResult } = require('./browser-tools.cjs')

// Runs in a Chromium isolated world. The site cannot replace the reference map.
function pageAction(action, args) {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  if (action === 'snapshot') {
    const refs = new Map(), prefix = Math.random().toString(36).slice(2, 8)
    const elements = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=checkbox],[role=link],[contenteditable=true]')].filter(visible).slice(0, 180).map((el, index) => {
      const ref = `${prefix}-${index + 1}`; refs.set(ref, el)
      const label = el.getAttribute('aria-label') || (el.labels ? [...el.labels].map((label) => label.innerText).join(' ') : '') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || ''
      return { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined, type: el.getAttribute('type') || undefined,
        name: label.trim().slice(0, 180), disabled: !!el.disabled,
        ...(el.matches('input,textarea') && el.type !== 'password' ? { value: String(el.value).slice(0, 500) } : {}),
        ...(el.tagName === 'SELECT' ? { options: [...el.options].slice(0, 80).map((option) => ({ value: option.value, label: option.label, selected: option.selected })) } : {}) }
    })
    globalThis.__zaiBrowserRefs = refs
    return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 22000), elements }
  }
  if (action === 'scroll') { window.scrollBy({ left: args.x || 0, top: args.y, behavior: 'instant' }); return { scrolled: true, x: scrollX, y: scrollY } }
  const el = globalThis.__zaiBrowserRefs?.get(args.ref)
  if (!el?.isConnected || !visible(el)) throw new Error('La referencia ya no es válida. Obtén una nueva lectura de la página.')
  if (el.disabled) throw new Error('El elemento está deshabilitado.')
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  if (action === 'click') { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  if (action === 'fill') {
    if (!el.matches('input,textarea,[contenteditable=true]') || el.readOnly) throw new Error('Este elemento no es un campo editable.')
    if (el.matches('input[type=file]')) throw new Error('La carga de archivos requiere intervención del usuario.')
    el.focus({ preventScroll: true })
    if (el.isContentEditable) el.textContent = args.value
    else { const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, args.value) }
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    return { filled: true }
  }
  if (action === 'select') {
    if (el.tagName !== 'SELECT' || ![...el.options].some((option) => option.value === args.value && !option.disabled)) throw new Error('Opción de selección inválida.')
    el.value = args.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    return { selected: true }
  }
  throw new Error('Acción no admitida.')
}
const deadline = (promise, duration = 20_000) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('El navegador no respondió a tiempo.')), duration) })]).finally(() => clearTimeout(timer))
}
function createBrowserController({ webContents, session, host, hasBrowser, navigate }) {
  const guests = new Map()
  const find = (id) => {
    const entry = guests.get(id), contents = entry && webContents.fromId(entry.guestId)
    return contents && !contents.isDestroyed() ? contents : null
  }
  const dom = (contents, action, args) => deadline(contents.executeJavaScriptInIsolatedWorld(731, [{ code: `(${pageAction.toString()})(${JSON.stringify(action)},${JSON.stringify(args)})` }], true))
  const cdp = async (contents, method, params) => {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    return deadline(contents.debugger.sendCommand(method, params))
  }
  return {
    register({ id, projectId, guestId }) {
      const contents = webContents.fromId(guestId)
      if (!hasBrowser(id, projectId) || !contents || contents.getType() !== 'webview' || contents.hostWebContents !== host() || contents.session !== session.fromPartition(`persist:zai-${projectId}-browser`)) throw new Error('Navegador no autorizado.')
      guests.set(id, { guestId, projectId })
      contents.once('destroyed', () => { if (guests.get(id)?.guestId === guestId) guests.delete(id) })
    },
    describe(id) { const contents = find(id); return { title: contents?.getTitle() || 'Navegador', url: contents?.getURL() || '', ready: !!contents } },
    async perform(id, action, args, signal) {
      let contents = find(id)
      if (action === 'navigate') {
        let url
        try { url = new URL(args.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error() }
        catch { throw new Error('Usa una dirección HTTP o HTTPS sin credenciales.') }
        if (!contents) {
          navigate({ browserId: id, url: url.toString() })
          const start = Date.now()
          while (!(contents = find(id))) {
            if (signal?.aborted || !hasBrowser(id) || Date.now() - start > 20_000) throw new Error('El navegador conectado no está disponible.')
            await new Promise((resolve) => setTimeout(resolve, 75))
          }
        } else await deadline(contents.loadURL(url.toString()))
        return textResult(await dom(contents, 'snapshot', {}))
      }
      if (!contents) throw new Error('El navegador está vacío. Usa zai_browser_navigate para abrir una página.')
      if (signal?.aborted) throw new Error('Acción cancelada.')
      if (action === 'screenshot') {
        const image = await deadline(contents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        if (image.isEmpty()) throw new Error('No se pudo capturar el navegador. Restaura la ventana e inténtalo otra vez.')
        const resized = image.getSize().width > 1400 ? image.resize({ width: 1400 }) : image
        return { content: [{ type: 'image', mimeType: 'image/png', data: resized.toPNG().toString('base64') }] }
      }
      if (action === 'click') {
        const point = await dom(contents, action, args)
        await cdp(contents, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await cdp(contents, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await cdp(contents, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
        return textResult('Elemento pulsado. Obtén una nueva lectura para comprobar el resultado.')
      }
      if (action === 'press') {
        const keys = { Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Backspace: ['Backspace', 8], Delete: ['Delete', 46], Space: ['Space', 32, ' '] }
        const selectAll = args.key === 'Control+A' || args.key === 'Meta+A'
        const key = selectAll ? ['KeyA', 65] : keys[args.key]
        if (!key) throw new Error('Tecla no admitida.')
        const params = { key: selectAll ? 'a' : args.key === 'Space' ? ' ' : args.key, code: key[0], windowsVirtualKeyCode: key[1], modifiers: selectAll ? process.platform === 'darwin' ? 4 : 2 : 0 }
        await cdp(contents, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(key[2] ? { text: key[2] } : {}) })
        await cdp(contents, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
        return textResult('Tecla enviada. Obtén una nueva lectura para comprobar el resultado.')
      }
      return textResult(await dom(contents, action, args))
    },
    dispose() { for (const id of guests.keys()) { const contents = find(id); try { if (contents?.debugger.isAttached()) contents.debugger.detach() } catch {} }; guests.clear() },
  }
}
module.exports = { createBrowserController }

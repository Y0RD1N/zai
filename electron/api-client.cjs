const localOllama = (p) => p.kind === 'ollama-local' || p.kind === 'ollama-cloud'
function apiURL(p, route) {
  let base = p.baseUrl.replace(/\/$/, '')
  if (localOllama(p)) base = base.replace(/\/v1$/, '')
  return base + route
}
async function request(p, route, body, signal, timeout = 60_000) {
  const timed = AbortSignal.timeout(timeout)
  const response = await fetch(apiURL(p, route), { method: body === undefined ? 'GET' : 'POST', headers: { ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(p.kind === 'openrouter' ? { 'X-Title': 'Zai' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timed]) : timed, redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    const detail = response.status === 401 || response.status === 403 ? 'La clave o sus permisos no fueron aceptados.' : response.status === 402 ? 'Revisa el saldo o presupuesto de tu cuenta.' : response.status === 429 ? 'Se alcanzó un límite del proveedor; espera antes de reintentar.' : response.status === 404 ? 'No se encontró el endpoint o modelo; revisa la dirección y el identificador.' : response.status >= 500 ? 'El servicio no está disponible temporalmente.' : 'Revisa el modelo y los parámetros que admite tu servidor.'
    throw new Error(`El proveedor respondió HTTP ${response.status}. ${detail}`)
  }
  return response
}
async function readBuffer(response, max = 32_000_000) {
  const chunks = []; let size = 0
  try { for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('Respuesta del proveedor demasiado grande.'); chunks.push(Buffer.from(chunk)) } }
  catch (e) { await response.body?.cancel().catch(() => {}); throw e }
  return Buffer.concat(chunks)
}
async function json(p, route, body, signal, timeout) {
  const response = await request(p, route, body, signal, timeout)
  const text = (await readBuffer(response, 45_000_000)).toString('utf8')
  try { return JSON.parse(text) } catch { throw new Error('El proveedor no devolvió JSON válido.') }
}
async function* lines(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', total = 0
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break
      total += value.length; if (total > 24_000_000) throw new Error('La respuesta excedió el límite de este turno.')
      pending += decoder.decode(value, { stream: true })
      let index
      while ((index = pending.indexOf('\n')) >= 0) { yield pending.slice(0, index).replace(/\r$/, ''); pending = pending.slice(index + 1) }
    }
    pending += decoder.decode(); if (pending) yield pending
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function completion(p, { model, messages, tools, effort, speed = 'default', generation = {}, signal, onText }) {
  const native = localOllama(p)
  const thinking = effort === 'none' ? false : effort === 'enabled' ? true : effort || undefined
  const body = { model, messages, ...(generation.maxOutputTokens && !native ? { max_tokens: generation.maxOutputTokens } : {}), tools: tools.length ? tools : undefined, stream: true,
    ...(native ? { ...(thinking !== undefined ? { think: thinking } : {}), ...(generation.maxOutputTokens ? { options: { num_predict: generation.maxOutputTokens } } : {}) } : { stream_options: { include_usage: true }, ...(p.kind === 'openrouter' ? { provider: { require_parameters: true, ...(['latency', 'throughput'].includes(speed) ? { sort: speed } : {}) }, ...(generation.reasoningBudget ? { reasoning: { max_tokens: generation.reasoningBudget } } : effort ? { reasoning: effort === 'enabled' ? { enabled: true } : { effort } } : {}) } : p.kind === 'deepseek' && effort ? { thinking: { type: effort === 'none' ? 'disabled' : 'enabled' }, ...(effort !== 'none' ? { reasoning_effort: effort } : {}) } : effort ? { reasoning_effort: effort } : {}) }) }
  const response = await request(p, native ? '/api/chat' : '/chat/completions', body, signal, 10 * 60_000)
  const assistant = { role: 'assistant', content: '' }, calls = new Map()
  let usage = {}, finished = false, finishReason
  for await (const line of lines(response)) {
    if (!line || !native && !line.startsWith('data:')) continue
    const data = native ? line : line.slice(5).trim()
    if (data === '[DONE]') { finished = true; break }
    let event; try { event = JSON.parse(data) } catch { throw new Error('Flujo de respuesta inválido.') }
    if (event.error) throw new Error(typeof event.error === 'string' ? event.error : event.error.message || 'El proveedor interrumpió la respuesta.')
    const delta = native ? event.message : event.choices?.[0]?.delta
    if (delta?.content) { assistant.content += delta.content; onText(delta.content) }
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) if (typeof delta?.[key] === 'string') assistant[key] = (assistant[key] || '') + delta[key]
    if (delta?.reasoning_details) {
      assistant.reasoning_details ||= []
      for (const detail of delta.reasoning_details) {
        const previous = assistant.reasoning_details.find((v) => detail.index !== undefined && v.index === detail.index && v.type === detail.type && (!detail.id || !v.id || v.id === detail.id))
        if (previous) { for (const [key, value] of Object.entries(detail)) { if (['text', 'summary', 'data', 'signature'].includes(key) && typeof value === 'string') previous[key] = (previous[key] || '') + value; else previous[key] = value } }
        else assistant.reasoning_details.push({ ...detail })
      }
    }
    for (const [index, call] of (delta?.tool_calls || []).entries()) {
      const slot = native ? calls.size : call.index ?? index
      const item = calls.get(slot) || { id: call.id || `call_${require('node:crypto').randomUUID()}`, type: 'function', function: { name: '', arguments: '' } }
      if (call.id) item.id = call.id
      if (call.function?.name) item.function.name += call.function.name
      if (call.function?.arguments !== undefined) item.function.arguments += typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments)
      calls.set(slot, item)
    }
    if (event.usage) usage = event.usage
    if (native && event.done) { finishReason = event.done_reason; usage = { prompt_tokens: event.prompt_eval_count, completion_tokens: event.eval_count }; finished = true }
    if (event.choices?.[0]?.finish_reason) { finishReason = event.choices[0].finish_reason; finished = true }
  }
  if (!finished) throw new Error('La conexión terminó antes de completar la respuesta. Puedes reintentar el turno.')
  if (finishReason === 'length') throw new Error('Se alcanzó el límite de salida antes de terminar. Aumenta el límite o reduce el presupuesto de razonamiento y vuelve a enviar el mensaje.')
  if (p.kind === 'deepseek' && tools.length && assistant.reasoning_content === undefined) assistant.reasoning_content = ''
  if (calls.size) assistant.tool_calls = [...calls.values()]
  if (native) for (const call of assistant.tool_calls || []) { try { call.function.arguments = JSON.parse(call.function.arguments || '{}') } catch { throw new Error('El modelo devolvió argumentos de herramienta inválidos.') } }
  return { assistant, usage }
}
module.exports = { request, json, readBuffer, completion, localOllama, apiURL }

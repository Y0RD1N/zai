# Proveedores API para el motor de agentes de Zai

Investigación documental comprobada el 16 de octubre de 2026. No se han leído claves personales, enviado inferencias de pago ni modificado la aplicación. Los nombres y capacidades deben descubrirse al conectar, porque los proveedores los cambian.

## 1. ¿Qué endpoints, autenticación y descubrimiento de modelos necesita cada proveedor?

### Takeaway

Los cuatro destinos permiten un transporte Chat Completions común, pero requieren adaptadores para conservar razonamiento, descubrir capacidades y presentar uso real. Para Ollama recomiendo API nativa: permite controlar contexto y consultar metadatos sin perder funciones detrás de la compatibilidad parcial.

### Cited Findings

| Destino | Base y autenticación | Descubrimiento |
| --- | --- | --- |
| DeepSeek directo | `https://api.deepseek.com`, `Authorization: Bearer <key>`, `POST /chat/completions`. También publica formato Anthropic en `/anthropic` y Responses. | `GET /models`: `data[]` con identificador, nombre, `context_window`, `max_output_tokens`, modalidades, `effort.supported_levels/default_level`, capacidades por protocolo. |
| OpenRouter | `https://openrouter.ai/api/v1`, Bearer, `POST /chat/completions`; `HTTP-Referer` y `X-OpenRouter-Title` son opcionales. | `GET /models`, público, con contexto, precios, modalidades y `supported_parameters`; filtrar `?supported_parameters=tools`. |
| Ollama Cloud directo | Nativa `https://ollama.com/api`; compatible `https://ollama.com/v1`; Bearer obligatorio. No requiere instalar Ollama. | `GET https://ollama.com/api/tags`; usar exactamente los identificadores devueltos. |
| Ollama local | Nativa `http://localhost:11434/api`; compatible `/v1`; no requiere clave. | `GET /api/tags`, `POST /api/show {"model":"…"}`, `GET /api/ps`. |

Fuentes de la tabla: [DeepSeek primer acceso](https://api-docs.deepseek.com/), [DeepSeek Models API](https://api-docs.deepseek.com/api/list-models/), [OpenRouter API](https://openrouter.ai/docs/api_reference/overview), [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models), [Ollama bases](https://docs.ollama.com/api/introduction), [Ollama Cloud](https://docs.ollama.com/cloud), [Ollama autenticación](https://docs.ollama.com/api/authentication), [Ollama tags](https://docs.ollama.com/api/tags).

- DeepSeek actualmente documenta `deepseek-flash` (DeepSeek-V4.1-Flash) y `deepseek-v4-pro`. Los alias antiguos Flash redirigen a Flash nuevo. El ejemplo de `/models` publica 1.048.576 tokens de contexto y 393.216 de salida para ambos; Flash acepta imagen y Pro, texto. No inferir que el identificador de entrenamiento antiguo sigue siendo el modelo servido. — [Primer acceso](https://api-docs.deepseek.com/), [Models API](https://api-docs.deepseek.com/api/list-models/).
- OpenRouter omite generadores de imagen del catálogo por defecto; para ellos usar `output_modalities=image` o `all`. El catálogo incluye `context_length`, `top_provider.max_completion_tokens`, precios como cadenas USD por token/unidad y `supported_parameters`; los precios pueden tener excepciones por contexto u horario. — [Catálogo](https://openrouter.ai/docs/guides/overview/models).
- Ollama diferencia los nombres de API cloud directa de los nombres de CLI/servidor local autenticado: por ejemplo API directa `gemma4:31b`, aplicación/CLI `gemma4:cloud`. Un servidor local conectado puede remitir modelos cloud sin que Zai tenga una API key, pero eso sigue siendo ejecución remota. — [Cloud](https://docs.ollama.com/cloud), [Autenticación](https://docs.ollama.com/api/authentication).
- `/api/show` devuelve `capabilities`, `thinking`, `model_info`, parámetros, cuantización, familia y licencia; el límite del modelo suele aparecer como `<architecture>.context_length`. `/api/ps` muestra `context_length` realmente cargado y `size_vram`. — [Show](https://docs.ollama.com/api-reference/show-model-details), [PS](https://docs.ollama.com/api/ps).
- Existe una discrepancia documental: la FAQ dice contexto predeterminado 4.096, pero la página específica actual dice 4K con <24 GiB VRAM, 32K con 24–48 GiB y 256K con ≥48 GiB; cloud usa el máximo del modelo. Ollama recomienda al menos 64K para agentes/código y advierte mayor consumo de memoria. — [Context length](https://docs.ollama.com/context-length); contradicción con [FAQ](https://docs.ollama.com/faq).

### Inferences

- Arquitectura propuesta: interfaz interna `ProviderAdapter` con `listModels()`, `streamTurn()`, `normalizeUsage()`, `getAccountUsage()` y `abort()`. Reutilizar transporte y parser SSE en DeepSeek/OpenRouter y conservar extensiones específicas. Usar NDJSON nativo en Ollama local/cloud. Es una propuesta de ingeniería, basada en las diferencias documentadas arriba.
- Descubrir capacidades por modelo y versión; ausencia de metadatos debe significar «desconocido» y controles conservadores. Un nombre con “reasoner” o “coder” no basta para habilitar herramientas, visión ni esfuerzo.
- Mostrar «Local» o «Cloud» según destino y modelo. No describir una petición a un servidor Ollama local que actúa como proxy cloud como procesamiento completamente local.
- Separar máximo teórico del modelo de contexto asignado al proceso. Ofrecer contexto local configurable sin fijar automáticamente 64K si el equipo no tiene memoria suficiente.

### Gaps

- La documentación no garantiza que cada modelo del catálogo tenga la misma calidad o fiabilidad al usar herramientas. Es necesario certificar modelos concretos con pruebas propias; no puede prometerse equivalencia con Claude Code a partir de compatibilidad HTTP.
- Los modelos pueden retirarse o sus alias cambiar; los nombres anteriores son una instantánea documental, no una lista para fijar permanentemente en el producto.
- No se verificaron respuestas autenticadas reales ni recursos GPU del equipo: no se han solicitado secretos o inferencias.

## 2. ¿Cómo implementar streaming, herramientas, razonamiento y cancelación sin romper el protocolo?

### Takeaway

La herramienta la ejecuta Zai, después de validación y permisos, y el modelo recibe su resultado en otra petición. Conservar la respuesta original completa de cada proveedor es esencial: una traducción que solo guarde `content` rompe agentes con razonamiento y firmas.

### Cited Findings

- En Chat Completions, una llamada es `{id,type:"function",function:{name,arguments:"JSON"}}`. El historial siguiente conserva el mensaje `assistant.tool_calls` y añade `{role:"tool",tool_call_id:id,content:"resultado"}`. OpenRouter exige incluir `tools` en cada petición, incluso al devolver resultados. — [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling).
- En DeepSeek streaming, acumular `delta.tool_calls` por `index`: primer fragmento aporta ID/tipo/nombre y los posteriores argumentos parciales. Los argumentos generados pueden ser JSON inválido o contener parámetros inventados: validarlos antes de ejecutar. SSE termina en `[DONE]`; la última trama incluye `usage` aunque no se pida `include_usage`, y puede repetir un final sin texto. — [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).
- DeepSeek con `tools` exige reenviar `reasoning_content` completo de todos los turnos previos, incluidos los que no llamaron herramientas; si falta devuelve 400. Sin herramientas puede ignorar ese campo. El pensamiento se habilita con `thinking:{type:"enabled"}` y esfuerzo `reasoning_effort`; los niveles actuales reales son `low`, `high`, `max`, valor por defecto `high`. Temperature y penalizaciones no controlan thinking; otros nombres de esfuerzo se mapean y no equivalen a modos nativos diferentes. — [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).
- DeepSeek soporta JSON Schema estricto en beta, con base `/beta` y `function.strict:true`, validando solo su subconjunto de esquemas. La API Chat Completion restringe insertar llamadas sintéticas en mitad del historial; Responses y Anthropic admiten más cambios. — [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/).
- OpenRouter normaliza razonamiento como `reasoning`/`reasoning_details`, con objetos que pueden incluir firmas/datos cifrados. Hay que preservar los bloques y su orden para posteriores llamadas. `GET /models` puede incluir `reasoning.supported_efforts`, `default_effort`, `default_enabled`, `mandatory` y `supports_max_tokens`; no todos los modelos exponen esfuerzos o permiten deshabilitar thinking. `max_tokens` suele compartir presupuesto entre razonamiento y respuesta. — [Reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
- OpenRouter `provider:{require_parameters:true}` impide enrutar a proveedores que ignoren parámetros solicitados. Sin ello, incluso `tools` puede ignorarse si ningún destino del modelo lo soporta. Tiene políticas de selección, fallback y privacidad; no suponer que una marca de modelo fija al proveedor físico. — [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).
- Ollama nativo devuelve argumentos como objeto, no cadena: `tool_calls[].function.arguments`. Las respuestas de herramienta se devuelven como `{role:"tool",tool_name:name,content:"…"}`. En streaming acumular `thinking`, `content` y `tool_calls` y reenviar el mensaje conjunto antes de resultados. Su guía documenta bucle y múltiples llamadas. — [Ollama tools](https://docs.ollama.com/capabilities/tool-calling).
- Ollama nativo transmite `application/x-ndjson`, un JSON por línea, no SSE. `POST /api/chat` tiene `stream:true` por defecto, admite `tools`, `options` y `think`; métricas finales llegan cuando `done:true`. — [Streaming](https://docs.ollama.com/api/streaming), [Chat](https://docs.ollama.com/api/chat).
- Ollama `think` acepta booleanos, null o nombres exactos de `thinking.values` obtenidos en `/api/show`; `values:[false]` declara que no hay pensamiento y omisión significa sin metadatos. No mostrar niveles no anunciados: un nombre no reconocido puede usar silenciosamente el predeterminado. — [Thinking](https://docs.ollama.com/capabilities/thinking).
- Ollama compatible con OpenAI admite solo un subconjunto de la API, incluido herramientas/streaming/razonamiento. `/v1/responses` es sin estado en cloud; no admite todas las herramientas integradas. El formato OpenAI no permite asignar `num_ctx`; su guía propone un Modelfile, mientras el nativo permite `options.num_ctx`. — [Compatibilidad](https://docs.ollama.com/api/openai-compatibility), [FAQ](https://docs.ollama.com/faq).
- OpenRouter SSE incluye comentarios `:` de mantenimiento y errores dentro de eventos después de HTTP200. El final de Chat Completions agrega una trama de contabilidad y puede repetir `finish_reason`: no contar dos finales. Abortar la conexión detiene cómputo y cobro solo con proveedores compatibles; para otros pueden continuar. — [Streaming OpenRouter](https://openrouter.ai/docs/api_reference/streaming).
- El SDK oficial `ollama-js` ofrece `abort()` que cancela todas las generaciones de su instancia y causa `AbortError`; recomienda una instancia por stream para cancelación independiente. Su implementación usa `AbortController` y parser NDJSON. — [SDK oficial](https://github.com/ollama/ollama-js), [Implementación](https://github.com/ollama/ollama-js/blob/main/src/browser.ts).

### Inferences

- Núcleo propuesto: pedir turno → acumular mensaje y llamadas completas → validar JSON/Schema → consultar permiso por herramienta → ejecutar mediante registro cerrado → guardar resultado → nuevo turno, hasta respuesta final, cancelación o límite. Ejecutar llamadas de escritura/navegador en orden; paralelizar solo lecturas independientes. Guardar IDs y mensaje original de proveedor separado de las piezas visuales de la conversación.
- Nunca ejecutar un fragmento parcial de argumentos, usar `eval` sobre él ni convertir un texto que «parece herramienta» en acción. Resolver nombres únicamente contra herramientas habilitadas para ese agente; desconocidos devuelven error estructurado.
- Compartir el broker existente del navegador con el agente propio: descubrir únicamente herramientas de navegadores conectados y llamar su ejecutor validado. La conexión física sigue representando autorización real; no necesita una API de browser especial del proveedor de modelo.
- Proteger el bucle con máximo de pasos, tiempo, tokens, longitud de resultados, presupuesto opcional y cancelación. Una política de permisos no se sustituye por instrucciones en el prompt.
- Cancelación por ejecución mediante AbortController y revocación de operaciones pendientes. No prometer «no se cobró nada» tras detener una API remota; una respuesta abortada puede no incluir uso final. Registrar uso faltante como desconocido, no cero.
- Un parser propio debe conservar buffers UTF-8 y de líneas entre paquetes. Los ejemplos simplificados que separan cada paquete de red por `\n` sin buffer no son un patrón suficiente para producción.

### Gaps

- No se encontró en estas fuentes garantía del DeepSeek directo sobre el momento exacto en que abortar el HTTP detiene la facturación. Se puede cancelar el cliente sin prometer esa garantía económica.
- No se ha probado compatibilidad real de una librería concreta con todas las extensiones actuales. Antes de elegir SDK, comprobar que conserva `reasoning_content`, `reasoning_details`, firmas y tool-call deltas en serialización y reanudación.
- No hay modo universal «Rápida» equivalente a Codex fast para todos los proveedores. Se pueden ofrecer preferencias de routing/rendimiento documentadas o mostrar tokens/s medidos; no inventar un service tier.

## 3. ¿Qué uso puede mostrarse y cómo integrar claves/endpoints de forma segura en Electron?

### Takeaway

Mostrar tokens y costes reales publicados, saldos como saldos y cuotas únicamente cuando existan límites explícitos. Las API keys pertenecen al proceso principal y almacén de secretos del sistema, con los agentes y páginas fuera de ese almacén.

### Cited Findings

- DeepSeek devuelve tokens de entrada/salida/razonamiento y caché (`prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` y equivalentes en detalles). `GET /user/balance` Bearer devuelve `is_available`, moneda CNY/USD, `total_balance`, `granted_balance`, `topped_up_balance` como cadenas. No es una cuota de cinco horas. — [Chat](https://api-docs.deepseek.com/api/create-chat-completion/), [Balance](https://api-docs.deepseek.com/api/get-user-balance/).
- DeepSeek tiene tarifas distintas por caché, modelo y horarios pico; las precios pueden cambiar. El coste calculado por Zai debe etiquetarse estimación y registrar la tarifa aplicada y fecha, no presentarlo como cargo liquidado del proveedor. — [Pricing](https://api-docs.deepseek.com/quick_start/pricing/).
- OpenRouter `usage` informa prompt/completion/total, detalles de reasoning/caché, `cost` realmente cobrado y opcional coste upstream. El uso siempre viene en las respuestas y en la trama final de streaming. — [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
- OpenRouter `GET /api/v1/key` informa uso total/diario/semanal/mensual, `limit`, `limit_remaining`, `limit_reset`, `budgets[]`, `effective_budget` y posible cupo diario gratuito. Límites null son ilimitados para ese campo, no cero ni prueba de saldo infinito. Los presupuestos indican ventanas y reset UTC; hay errores402/429 con metadatos de causa y Retry-After. — [Limits](https://openrouter.ai/docs/api_reference/limits).
- Ollama Cloud `GET /api/balance` Bearer publica `included.balance_usd`, `allowance_usd`, `period.from/until` del ciclo mensual y `purchased.balance_usd`. Planes legacy devuelven `included.session`/`weekly` con `remaining_percent` 0–100 y `resets_at`. Los equipos comparten saldos. Máximo10 consultas/minuto por usuario; recomienda1/min. — [Balance](https://docs.ollama.com/api/balance).
- Ollama Cloud `GET /api/usage?range=24h|7d|30d` devuelve totales y buckets con solicitudes, USD y tokens; `group_by=model` aporta desglose y `scope=self|team` depende del rol. Los datos pueden retrasarse, legacy solo cuenta solicitudes y máximo10/min recomienda1/min. Los rangos son días/horas UTC completos más el parcial actual, no «mes de suscripción». — [Cloud usage](https://docs.ollama.com/api/cloud-usage).
- Ollama nativo mide `prompt_eval_count`, caché, `eval_count` y duraciones en nanosegundos. Las métricas de stream están en `done:true`, de donde puede derivarse velocidad observada `eval_count / eval_duration × 1e9`. — [Usage](https://docs.ollama.com/api/usage).
- Electron ya incorpora un entorno Node.js en el proceso principal; no hace falta instalar Node independiente para código de red/loop que se empaquete con la aplicación. — [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model).
- `safeStorage` usa Keychain en macOS, DPAPI en Windows y almacenes como Secret Service/KWallet en Linux. En Linux `basic_text` usa una contraseña fija y no es protección de secretos; detectarlo mediante `getSelectedStorageBackend()`. Las garantías no son iguales: Windows no aísla de otras apps del mismo usuario. La API asíncrona actual existe, pero debe comprobarse en la versión Electron empaquetada. — [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- Electron requiere validar el emisor IPC y mantener aislamiento, sandbox y ninguna API Electron expuesta a contenido no confiable. Ollama indica explícitamente mantener claves fuera de código del navegador y control de versiones. — [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Ollama auth](https://docs.ollama.com/api/authentication).
- OWASP recomienda esquemas/destinos autorizados, validación de direcciones y desactivar redirecciones para evitar eludir una política de URL; advierte que validar DNS y luego resolver otra vez no evita rebinding. — [SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### Inferences

- Guardar en `userData` un archivo de secretos cifrados separado del workspace con permisos restrictivos, y en el workspace solo `providerId/modelId`. La UI envía una clave una vez para guardarla; las lecturas devuelven únicamente nombre, configurada/no, últimos caracteres opcionales, nunca el valor. Exportaciones de pizarra, diagnósticos, prompts, herramientas y logs excluyen las claves.
- Si no existe almacén seguro, usar clave solo en memoria durante esa sesión. Nunca llamar a `setUsePlainTextEncryption(true)` para hacer que parezca resuelto. Mantener las claves fuera del environment que heredan terminales/agentes del usuario.
- La política de endpoints cloud incorporados debe fijar HTTPS y host exacto conocido; denegar credenciales en URL, fragmentos y redirecciones. Ollama local por defecto admite localhost/127.0.0.1/[::1] con puerto explícito y sin API key de cloud adjunta. Un servidor LAN o endpoint compatible personalizado es una configuración independiente del usuario, no una URL que un prompt puede modificar. La política debe seguir vigente en retries y redirects.
- Para proveedores compatibles personalizados, nunca reenviar automáticamente una clave de DeepSeek/OpenRouter/Ollama a un host cambiado. Credencial vinculada al origen, nueva validación al cambiarlo y solicitudes desde main; el navegador conectado no puede consultar o reconfigurar proveedores.
- Dashboard propuesto: «Esta conversación» con tokens, coste facturado/estimado claramente distinguido y velocidad observada; «Cuenta» con saldos/límites y fecha de actualización. OpenRouter cuotas explícitas y Ollama legacy se pueden representar como barras reales; DeepSeek saldo no necesita porcentaje. Ollama local muestra actividad/tokens/recursos sin fingir cuota de suscripción.
- Para cuota Ollama incluida nueva: porcentaje usado = `(allowance_usd-balance_usd)/allowance_usd` solo si allowance es finito y positivo, y ciclo mostrado desde `period`; no mezclar comprado con incluido. Legacy: usado = `100-remaining_percent`, etiqueta «Sesión» si proveedor no da duración exacta.
- Pruebas necesarias antes de declarar soporte: SSE dividido en UTF-8/JSON, varios índices de herramienta, herramienta JSON inválida, reasoning completo tras segunda vuelta, firmas conservadas, permisos denegados, cancelación individual concurrente, error200-in-stream, cuota null/cero, keyvault sin Secret Service, exportación sin secretos y endpoint cambiado sin fuga de auth.

### Gaps

- No se conocen límites, saldos o cuotas de las cuentas del usuario y no se han consultado. Los esquemas permiten implementarlos cuando el usuario configure su acceso.
- No se ha determinado qué almacén seguro tendrá cada instalación Fedora/macOS/Windows. Debe comprobarse al ejecutar el binario empaquetado.
- Un motor con herramientas puede incorporar sesiones, skills, MCP, memoria, comandos y navegador, pero la disponibilidad/efectividad depende tanto del harness implementado como del modelo elegido. La compatibilidad con una API no aporta automáticamente todas las funciones de Claude Code.

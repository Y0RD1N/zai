# Fondos personalizados y generación de imágenes para Zai

Investigación documental verificada el 16 de octubre de 2026. No se usaron claves, no se realizaron generaciones de pago y no se modificó la aplicación.

## ¿Qué adaptadores de nube conviene implementar y qué contrato utiliza cada uno?

### Takeaway

Recomiendo tres entradas claramente distintas en la interfaz: **OpenRouter**, **OpenAI** y **API de imágenes compatible**. OpenRouter ya dispone de un endpoint dedicado para imágenes, por lo que conviene integrarlo directamente; un servicio compatible con chat no necesariamente implementa generación de imágenes. [OpenRouter: API de imágenes](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [OpenAI: generar imagen](https://developers.openai.com/api/reference/resources/images/methods/generate).

### Cited Findings

- OpenRouter: `POST https://openrouter.ai/api/v1/images`, autenticación `Authorization: Bearer …`, JSON mínimo `{model,prompt}`. La respuesta contiene `data[].b64_json`, `media_type` cuando se identifica, y `usage` con coste cuando está disponible. Puede devolver PNG, JPEG, WebP o SVG. Los parámetros incluyen `n`, `aspect_ratio`, `resolution`, `size`, `quality`, `output_format`, `seed`; su soporte depende del endpoint. Un tamaño explícito incompatible con la proporción declarada produce 400. — [Documentación oficial](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).
- Descubrimiento OpenRouter: `GET /api/v1/images/models` devuelve identificadores, modalidades de entrada/salida, descriptores de parámetros y `supports_streaming`; cada modelo enlaza sus registros de endpoints. — [Catálogo oficial](https://openrouter.ai/docs/api/api-reference/images/list-image-models).
- El anuncio de junio de 2026 explica que el catálogo detallado evita asumir que todos los modelos admiten las mismas proporciones, cantidades o imágenes de referencia. — [Anuncio de la API unificada](https://openrouter.ai/blog/announcements/image-api/).
- Streaming OpenRouter: `stream:true` utiliza SSE, con eventos `image_generation.partial_image`, `image_generation.completed`, `error` y terminación `[DONE]`. El resultado final lleva base64. La documentación publicada también describe facturación completa o fallo, sin cobro parcial de imágenes. — [Fuente primaria de la documentación](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/multimodal/image-generation.mdx).
- El endpoint de chat OpenRouter acepta `modalities:["text","image"]`. Esto acredita que existe esa superficie de solicitud, pero su referencia actual no expone claramente la forma del campo de imágenes en la respuesta. — [Referencia de chat](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
- OpenRouter también ofrece un server tool beta `openrouter:image_generation`; el modelo de chat decide cuándo llamarlo y su coste se suma al del chat. No hace falta ese segundo modelo para un botón explícito «Generar fondo». — [Server tool de imágenes](https://openrouter.ai/docs/guides/features/server-tools/image-generation).
- OpenAI oficial: `POST https://api.openai.com/v1/images/generations`, Bearer, `{model,prompt,n:1,size}`. GPT Image devuelve base64 por defecto; `response_format` es un parámetro legado no admitido por GPT Image. Los tamaños comunes incluyen `1536x1024`; los modelos más recientes aceptan dimensiones adicionales con restricciones. No usar modelos DALL·E retirados como predeterminado. — [Referencia oficial](https://developers.openai.com/api/reference/resources/images/methods/generate).
- Los formatos actuales de OpenAI son PNG, JPEG y WebP. La guía recomienda JPEG cuando prima latencia. — [Guía oficial de imágenes](https://developers.openai.com/api/docs/guides/image-generation).

### Inferences

- Arquitectura propuesta: `ImageAdapter.generate(config,prompt,signal,onProgress) → {bytes,mime,provider,model,usage?}` en el proceso principal. La interfaz común no debe ocultar que OpenRouter y OpenAI usan rutas distintas; sus contratos oficiales lo requieren. [OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [OpenAI](https://developers.openai.com/api/reference/resources/images/methods/generate).
- Para **API de imágenes compatible**, permitir URL base y modelo manual. Enviar inicialmente únicamente `{model,prompt,n:1,size}`; admitir `data[0].b64_json` o una URL devuelta por ese servicio, y habilitar parámetros adicionales por perfil. La existencia del contrato OpenAI no garantiza que un tercero lo implemente entero. [Esquema de referencia](https://developers.openai.com/api/reference/resources/images/methods/generate).
- Propuesta de controles: catálogo consultable en OpenRouter, selector de formato raster y relación panorámica cuando el catálogo la admita; no fijar un modelo/precio en código. Una clave de DeepSeek u Ollama para chat no debe presentarse automáticamente como generador de fondos: hay que configurar un motor que produzca imágenes. [Descubrimiento de modalidades](https://openrouter.ai/docs/api/api-reference/images/list-image-models).

### Gaps

- No confirmé por solicitudes reales el acceso a modelos de cada cuenta, precios actuales efectivos, límites de cada plan o disponibilidad regional. Deben mostrarse errores reales del proveedor.
- No recomiendo programar un parser histórico `choices[].message.images[].image_url.url` como única integración OpenRouter: las fuentes oficiales actuales priorizan `/images` y no establecen completamente ese contrato de respuesta del chat.
- No existe un timeout universal de generación. Como decisión de producto: timeout configurable de 3–10 minutos, cancelación explícita y barra indeterminada si no llega progreso real; no inventar porcentajes.

## ¿Qué servidores locales son adecuados y qué puede generar Ollama realmente?

### Takeaway

El adaptador local de menor complejidad es **Stable Diffusion WebUI API (AUTOMATIC1111/Forge)**. **ComfyUI** ofrece mejor control de colas y workflows, pero debe comprobar modelos y nodos antes de prometer que un preset funciona; Ollama debe figurar como integración de imágenes experimental y condicionada a plataforma/capacidad. [API A1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API), [ComfyUI](https://docs.comfy.org/development/comfyui-server/comms_routes), [Ollama](https://ollama.com/blog/image-generation).

### Cited Findings

- A1111 se inicia con `--api`; el OpenAPI instalado está en `/docs`. La guía oficial advierte que sus ejemplos históricos no se mantienen, por lo que debe contrastarse la versión del servidor. `POST /sdapi/v1/txt2img` devuelve `images` en base64 y campos `parameters` e `info`. — [Wiki oficial API](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API).
- El código actual registra `GET /sdapi/v1/sd-models`, `/samplers`, `/schedulers`, `/progress`; `/progress` calcula el estado global y puede incluir una imagen actual. `POST /sdapi/v1/interrupt` interrumpe el estado compartido. `--api-auth` aplica autenticación HTTP Basic. — [Implementación primaria de API](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/modules/api/api.py).
- El esquema de A1111 conserva `send_images:true`, `save_images:false`, `force_task_id`; la respuesta de progreso incluye `progress` de 0 a 1, `eta_relative`, `state` y `current_image`. — [Esquemas primarios](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/modules/api/models.py).
- Forge conserva la ruta `/sdapi/v1/txt2img` y el modelo de respuesta compatible. Es razonable llamarlo «A1111 / Forge», con prueba de conexión y contraste de esquema por versión. — [API oficial de Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge/blob/main/modules/api/api.py).
- ComfyUI: `POST /prompt` valida y encola un grafo, devolviendo `prompt_id` y posición o errores por nodo. Ofrece `/object_info`, `/models/{folder}`, `/queue`, `/history/{prompt_id}`, `/view`, `/ws` e interrupción. — [Rutas oficiales](https://docs.comfy.org/development/comfyui-server/comms_routes).
- El ejemplo oficial conecta `ws://127.0.0.1:8188/ws?clientId=…`, envía `{prompt,client_id,prompt_id}` a `/prompt`, espera eventos correspondientes a ese identificador, consulta su historial y descarga cada salida mediante `/view?filename=…&subfolder=…&type=…`. — [Ejemplo primario del servidor](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py).
- ComfyUI publica `execution_start`, `execution_error`, `execution_interrupted`, `execution_success` y `progress:{prompt_id,node,value,max}`. El evento `executed` ocurre cuando un nodo produce actualización de UI, no por cada nodo completado. — [Mensajes oficiales](https://docs.comfy.org/development/comfyui-server/comms_messages).
- Ollama anunció generación experimental el 20 de enero de 2026 para macOS, con Linux y Windows todavía indicados como próximos en la página consultada. Cita Z-Image Turbo y FLUX.2 Klein; los modelos de pesos no comparten necesariamente licencia: Klein 4B y Z-Image se anuncian Apache 2.0, Klein 9B bajo licencia no comercial. — [Anuncio oficial](https://ollama.com/blog/image-generation).
- Una rama oficial `ollama-imagegen-docs` documenta `POST /api/generate` con `model`, `prompt`, `width`, `height`, `steps`; el stream NDJSON trae `completed`, `total` y el resultado final `image` base64. Lo marca explícitamente experimental. — [Documentación de esa rama](https://github.com/ollama/ollama/blob/ollama-imagegen-docs/docs/api.md#image-generation-experimental), [Tipos de esa rama](https://github.com/ollama/ollama/blob/ollama-imagegen-docs/api/types.go).
- Hay una discrepancia relevante: los campos experimentales de imagen no figuran en el `api/types.go` de `main` recuperado en esta investigación. Por ello, la rama no demuestra por sí sola el contrato de toda versión distribuida. — [Tipos de main](https://github.com/ollama/ollama/blob/main/api/types.go).
- ComfyUI publica GPL-3.0 y A1111 AGPL-3.0. Son componentes distintos de los modelos y de sus licencias. — [Licencia ComfyUI](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE), [Licencia A1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/LICENSE.txt).

### Inferences

- Para A1111/Forge, propio adaptador HTTP pequeño: consultar servidor/modelos, pedir prompt, tamaño y pasos, `batch_size:1,n_iter:1,send_images:true,save_images:false`; tomar `images[0]`. No forzar cambio persistente de checkpoint en `/options`; preferir configuración por petición si el servidor la admite. [Wiki API](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API), [Esquemas](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/modules/api/models.py).
- El progreso A1111 es compartido. Si el usuario usa ese servidor desde otra aplicación, un porcentaje global no prueba que sea nuestro trabajo y `interrupt` puede afectar un trabajo ajeno. Mostrar esa limitación; por defecto, cancelar la espera local y no enviar interrupción global automáticamente. [Estado compartido](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/modules/api/api.py).
- Para ComfyUI, preset propio basado solo en nodos estándar (`CheckpointLoaderSimple`, codificadores de texto, latente, sampler, decodificador, guardado) exige que el checkpoint exista y sea compatible. Consultar `object_info` y modelos antes de encolar; ofrecer importación de workflow API y asignación explícita de nodos de prompt/dimensiones para usuarios avanzados. No descargar ni ejecutar nodos personalizados al importar un JSON. [API](https://docs.comfy.org/development/comfyui-server/comms_routes), [Ejemplo de grafo estándar](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py).
- Instalar los **adaptadores** al instalar Zai satisface la integración sin empaquetar Python, CUDA, varios GB de pesos y todos los generadores. Ofrecer detección/conexión del motor local existente; instalar automáticamente modelos requiere conocer GPU, memoria y licencia concreta. Es una recomendación de alcance, no un requisito de las APIs. [Motores](https://docs.comfy.org/development/comfyui-server/comms_routes), [Modelos Ollama](https://ollama.com/blog/image-generation).

### Gaps

- No se ejecutaron GPU, ComfyUI, A1111, Forge u Ollama de imágenes en este equipo. Compatibilidad de versiones y coste de memoria requieren validación real.
- No encontré confirmación oficial actual suficiente de generación Ollama disponible de forma estable en Fedora, Windows o Ollama Cloud. No anunciarla como funcional en esas plataformas solo porque el chat o la visión funcionan.
- Un porcentaje de pasos de un nodo ComfyUI no es progreso global lineal del workflow; presentar «paso X/Y» y nombre de fase.

## ¿Cómo guardar fondos y credenciales sin filtrar secretos ni perjudicar la interfaz?

### Takeaway

Separar preferencias visuales exportables de claves privadas, generar desde main y guardar imágenes como activos raster locales. Usar un fondo independiente de la capa de paneles permite oscurecer o desenfocar únicamente la imagen sin volver borroso el chat. Esta es una propuesta de implementación para Zai; la base técnica se apoya en las APIs de imagen, protocolo y almacenamiento de Electron. [Electron nativeImage](https://www.electronjs.org/docs/latest/api/native-image), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

### Cited Findings

- `safeStorage` pertenece a main y usa mecanismos del sistema: Keychain en macOS, DPAPI en Windows y proveedores de secretos en Linux. En Linux puede devolver backend `basic_text`, que no protege los secretos de manera adecuada; la documentación recomienda el API asíncrono cuando esté disponible. — [Documentación Electron](https://www.electronjs.org/docs/latest/api/safe-storage).
- `nativeImage` puede decodificar buffers, comprobar si la imagen está vacía, obtener dimensiones y redimensionar/exportar raster. — [Documentación Electron](https://www.electronjs.org/docs/latest/api/native-image).
- Electron admite protocolos propios, registrados para su sesión, con un handler controlado por la aplicación. — [Documentación Electron](https://www.electronjs.org/docs/latest/api/protocol).

### Inferences

- Guardar credenciales en un archivo propio cifrado fuera de `workspace.json` y fuera de exportaciones; exponer al renderer únicamente `hasKey`/identificador. Permitir reemplazar y borrar sin volver a leer la clave en la UI. En Linux `basic_text`, preferir clave solo durante la sesión o explicar que falta almacén seguro antes de persistirla; no llamar a una ofuscación «cifrado seguro». [Límites de safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- Al importar o recibir una imagen: comprobar formato por bytes, límite de tamaño y dimensiones, decodificar, redimensionar si es excesiva y guardar bajo nombre aleatorio dentro de `userData/backgrounds`. Guardar un ID en preferencias, no rutas arbitrarias ni base64 enorme en el espacio de trabajo. Servir solo ese conjunto permitido mediante protocolo dedicado. [Decodificación](https://www.electronjs.org/docs/latest/api/native-image), [Protocolo](https://www.electronjs.org/docs/latest/api/protocol).
- Para una primera versión, aceptar PNG/JPEG/WebP, rechazar SVG/HTML y animaciones; generar una vista previa antes de aplicar. Copiar la imagen elegida desde el selector nativo evita que mover el archivo original rompa el fondo. La biblioteca local puede conservar prompt/modelo/fecha voluntariamente, jamás claves. [Capacidad raster](https://www.electronjs.org/docs/latest/api/native-image).
- Propuesta visual: color sólido editable, imagen con `cover/contain`, posición, intensidad/oscurecimiento, puntos de cuadrícula opcionales, restablecer; imagen fija al viewport y paneles en la capa de mundo existente. El desenfoque decorativo se aplica a la imagen exclusivamente.
- Para URLs generadas por servicios compatibles: descargar desde main con límites, HTTP(S) y sin credenciales heredadas en redirecciones; nunca adjuntar la API key del proveedor a la URL del CDN. No mostrar mensajes de error sin redactar encabezados/secretos. Registrar fases reales «conectando / en cola / generando / guardando», progreso solo si lo proporciona el motor.

### Gaps

- La capacidad del `safeStorage` concreto depende de la versión Electron instalada y del escritorio del usuario; debe probarse en los tres sistemas soportados. No se inspeccionó ningún almacén ni credencial del usuario durante esta investigación.
- Los límites de archivos (por ejemplo 20 MB y máximo 8192 px por borde), retención de fondos y timeout propuestos son decisiones de producto, no garantías publicadas de los proveedores.

# Motores de agentes para Zai

## ¿Qué motor conviene integrar para un harness propio multiproveedor?

### Takeaway
Recomiendo un **ZaiRuntime propio**: interfaz, políticas, herramientas, navegador y sesiones controlados por Zai; transporte de modelos intercambiable mediante bibliotecas o adaptadores. **Pi SDK** es la alternativa embebible que más trabajo puede ahorrar sin introducir otro servidor; **OpenCode** es la alternativa con más funcionalidades listas, a costa de empaquetar y gobernar un motor externo. Esta es una recomendación de arquitectura, no una afirmación de equivalencia con Claude Code. Fuentes base: [Pi SDK 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md), [OpenCode SDK](https://opencode.ai/docs/sdk/), [AI SDK Agents](https://ai-sdk.dev/docs/agents/building-agents).

### Cited Findings
- El repositorio histórico `badlogic/pi-mono` redirige oficialmente a `earendil-works/pi`. El paquete actual es `@earendil-works/pi-coding-agent`; requiere Node 22.19 o posterior. El proyecto ofrece SDK TypeScript y modos RPC/JSON. — [Repositorio oficial](https://github.com/earendil-works/pi), [package.json del tag 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/package.json).
- El SDK Pi crea una sesión con `createAgentSession()`, expone eventos de mensajes/herramientas/compacción/reintentos y permite reemplazar modelos, almacenamiento, recursos y herramientas. El SDK **no activa automáticamente** las extensiones MCP del CLI: se configura `createMcpExtension()` y se vinculan las extensiones de la sesión. — [SDK Pi 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md).
- Pi evita expresamente incluir subagentes y modo plan como funciones predeterminadas; deben implementarse mediante extensiones o paquetes. Tampoco trae un sistema de permisos/sandbox para restringir archivos, procesos, red o credenciales. — [README oficial](https://github.com/earendil-works/pi), [seguridad Pi 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/security.md).
- OpenCode ofrece `opencode serve`, servidor HTTP sin TUI, OpenAPI y eventos SSE; el SDK TypeScript es su cliente. Sesiones, bifurcación, cancelación, mensajes y respuestas a permisos están disponibles como API. — [Servidor OpenCode](https://opencode.ai/docs/server/), [SDK OpenCode](https://opencode.ai/docs/sdk/).
- Instalar solamente `@opencode-ai/sdk` **no instala el motor**: en la versión 1.19.3 `createOpencodeServer()` lanza el comando `opencode` desde PATH. Para Zai conviene arrancar un binario empaquetado por ruta absoluta y usar `createOpencodeClient()` contra él. — [Implementación oficial del lanzador 1.19.3](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/sdk/js/src/server.ts), [cliente SDK](https://opencode.ai/docs/sdk/).
- Vercel AI SDK proporciona un agente con bucle de herramientas, condiciones de parada, configuración por paso y aprobaciones. Es infraestructura para construir agentes; no es por sí solo una aplicación completa de programación con skills, checkpoints y control de proyectos. — [Building Agents](https://ai-sdk.dev/docs/agents/building-agents), [Agents Overview](https://ai-sdk.dev/docs/agents/overview).

### Inferences
- Si la prioridad es cumplir literalmente «nuestro harness», conviene escribir el coordinador, el registro de herramientas y el formato de sesiones de Zai. Una biblioteca de transporte no convierte la aplicación en una copia de otro proyecto; sí debe reconocerse como dependencia. [Base: composición de AI SDK](https://ai-sdk.dev/docs/agents/building-agents).
- Si se acepta un núcleo de agente como dependencia, Pi ofrece un punto intermedio razonable: Zai puede aportar sus herramientas y permisos mientras Pi se encarga del historial ramificado, bucle y compacción. No activaría automáticamente extensiones ejecutables descubiertas en repositorios. [Base: puntos de sustitución SDK](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md), [modelo de confianza Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/security.md).
- Si el objetivo prioritario fuera amplitud funcional inmediata, elegiría OpenCode como motor opcional identificable —con interfaz propia de Zai— y mantendría una interfaz común para reemplazarlo posteriormente. Tiene más funciones listas que Pi, pero añade un proceso servidor y otro ciclo de actualización. [Base: servidor](https://opencode.ai/docs/server/), [agentes](https://opencode.ai/docs/agents/).

### Gaps
- No se ejecutaron tareas reales con claves ni benchmarks comparativos en esta investigación. No hay evidencia para decir que Pi u OpenCode producirán mejores cambios de código con el mismo modelo.
- La elección entre coordinador completamente propio y Pi SDK depende de cuánto núcleo externo se quiera admitir. El requisito anterior prohíbe copiar código de otros proyectos; no aclara si prohíbe bibliotecas de agente. La aplicación puede avanzar con un adaptador que permita ambas opciones.

## ¿Qué capacidades concretas ofrecen Pi y OpenCode para los proveedores y las herramientas?

### Takeaway
DeepSeek, OpenRouter y Ollama encajan en ambos diseños. El navegador debe exponerse como herramienta real gobernada por Zai: el harness ejecuta las acciones, mientras que el modelo solamente propone llamadas. Una API compatible no garantiza que todos sus modelos soporten herramientas, imágenes o razonamiento de igual manera. [Pi proveedores](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), [Pi modelos](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), [Ollama herramientas](https://docs.ollama.com/capabilities/tool-calling).

### Cited Findings
- Pi incluye DeepSeek y OpenRouter como proveedores con API key. La lista de modelos OpenRouter puede adaptarse a los modelos permitidos por la clave. — [Proveedores Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md).
- Pi configura Ollama mediante un endpoint compatible, por ejemplo `http://localhost:11434/v1` con protocolo `openai-completions`. También permite endpoints personalizados y metadatos por modelo; advierte que las opciones de compatibilidad deben basarse en diferencias verificadas. — [Modelos Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).
- Pi guarda sesiones como árbol, conserva ramas abandonadas y compacta el contexto con un resumen sin eliminar los registros originales. Hay reanudación, bifurcación y compacción manual. — [Sesiones Pi 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sessions.md).
- Las extensiones Pi pueden registrar herramientas, interceptar/bloquear llamadas, modificar contexto y registrar servidores MCP HTTP con cabeceras o stdio. Desregistrar un MCP cierra su conexión y retira el acceso a sus herramientas. Estas extensiones se ejecutan con los permisos del proceso. — [Extensiones Pi 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md).
- OpenCode documenta DeepSeek, OpenRouter, Ollama y Ollama Cloud. También permite proveedores personalizados. — [Proveedores OpenCode](https://opencode.ai/docs/providers/).
- La documentación de OpenCode aún describe un paso de `ollama pull` para Cloud; la documentación actual de Ollama permite llamar directamente a Cloud con API key **sin descargar la aplicación ni el modelo**. Por tanto, el conector Cloud de Zai debería verificar y preferir la ruta directa oficial. — [OpenCode providers/Ollama Cloud](https://opencode.ai/docs/providers/#ollama-cloud), [Ollama Cloud](https://docs.ollama.com/cloud).
- OpenCode tiene agentes principales Build/Plan y subagentes General/Explore/Scout, con herramientas y permisos configurables. También incluye un agente interno para compacción. — [Agentes OpenCode](https://opencode.ai/docs/agents/).
- OpenCode descubre skills en sus carpetas y también en `.claude/skills`, `~/.claude/skills`, `.agents/skills` y `~/.agents/skills`. Su formato portable no equivale a interpretar todas las extensiones específicas de Claude. — [Skills OpenCode](https://opencode.ai/docs/skills/).
- OpenCode soporta MCP local/remoto y permisos por herramientas. Sus plugins ofrecen puntos como `tool.execute.before`, `tool.execute.after`, `permission.asked` y eventos de sesiones. — [MCP OpenCode](https://opencode.ai/docs/mcp-servers/), [Plugins OpenCode](https://opencode.ai/docs/plugins/).
- Ollama documenta bucles de herramientas de varios turnos y streaming; hay que conservar y reenviar los campos parciales de contenido, pensamiento y llamadas a herramientas. — [Tool calling Ollama](https://docs.ollama.com/capabilities/tool-calling).
- OpenRouter requiere declarar las herramientas y devolver los resultados al modelo; la disponibilidad y el comportamiento dependen del modelo/proveedor seleccionado. — [Tool calling OpenRouter](https://openrouter.ai/docs/guides/features/tool-calling).

### Inferences
- La matriz de capacidades de Zai debería contener por modelo `tools`, `vision`, `reasoning`, límites de contexto y parámetros de esfuerzo soportados. No debe mostrar opciones de razonamiento/velocidad que el endpoint ignore. [Base: configuración por modelo Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), [herramientas OpenRouter](https://openrouter.ai/docs/guides/features/tool-calling).
- Las nueve herramientas del navegador conectado pueden usarse con modelos de texto mediante instantáneas semánticas y referencias; las capturas requieren visión para que el modelo las interprete. El cable debe seguir siendo una capacidad de Zai concedida por agente, no una recomendación textual en el prompt. [Base: MCP y herramientas](https://opencode.ai/docs/mcp-servers/), [tools Ollama](https://docs.ollama.com/capabilities/tool-calling).
- Un modelo sin llamadas fiables a herramientas puede tener chat normal, pero no debería presentarse como agente capaz de modificar archivos o navegar autónomamente. Esto requiere pruebas funcionales del endpoint, no solo aceptar una URL. [Base: herramientas OpenRouter](https://openrouter.ai/docs/guides/features/tool-calling).

### Gaps
- No se validó Ollama local en el equipo ni se descargaron pesos. La compatibilidad declarada requiere una prueba de herramientas con el modelo que elija la persona.
- No se auditó cada campo de skills Claude ni sus plugins. Compartir `SKILL.md` no garantiza portabilidad de `context: fork`, hooks específicos, políticas o herramientas que solo existen en Claude.

## ¿Qué significa acercarse a las funcionalidades de Claude Code sin prometer una copia completa?

### Takeaway
Es viable construir las familias de funcionalidades de un agente de programación: herramientas, permisos, navegador, skills, memoria de proyecto, sesiones, compacción, subagentes y checkpoints. La compatibilidad total con Claude Code, sus servicios y todas sus políticas no viene automáticamente de ningún SDK multiproveedor. [Funciones Claude](https://code.claude.com/docs/en/features-overview), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

### Cited Findings
- Claude distingue memoria de proyecto, skills/instrucciones bajo demanda, subagentes, MCP, plugins y hooks; son mecanismos distintos, no sinónimos. — [Extend Claude Code](https://code.claude.com/docs/en/features-overview).
- Claude Agent SDK expone herramientas, bucle, contexto, permisos, sesiones, skills, hooks y subagentes del motor Claude. Ejecuta el binario Claude; no se presenta como un runtime genérico para cualquier proveedor. Su utilización se rige por términos comerciales salvo componentes con otra licencia. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).
- Los permisos Claude incluyen reglas finas por herramientas, archivos, comandos, dominios, MCP y subagentes; están separados de la protección mediante sandbox del sistema operativo. — [Permisos Claude](https://code.claude.com/docs/en/permissions).
- Los hooks Claude se ejecutan en eventos de ciclo de vida; la interfaz admite varios tipos de handlers y contratos de entrada/salida por evento. — [Hooks Claude](https://code.claude.com/docs/en/hooks).
- Los subagentes Claude tienen contexto y configuración específicos, con herramientas, modelo, permisos y límites; aislamiento en worktrees y gestión de tareas añaden trabajo al simple lanzamiento de una segunda llamada al modelo. — [Subagentes Claude](https://code.claude.com/docs/en/sub-agents).
- Los checkpoints de Claude tampoco son backups universales: no deshacen cambios arbitrarios efectuados por comandos Bash y tienen limitaciones con cambios externos o de subagentes. — [Checkpointing Claude](https://code.claude.com/docs/en/checkpointing).
- OpenCode tiene respuestas `allow`/`ask`/`deny`, patrones de permisos y controles por agente. Sus plugins pueden interceptar herramientas; sus APIs permiten resumir, bifurcar y revertir sesiones. — [Permisos OpenCode](https://opencode.ai/docs/permissions/), [Plugins OpenCode](https://opencode.ai/docs/plugins/), [Servidor](https://opencode.ai/docs/server/).

### Inferences
Esta matriz es una estimación de implementación, no una garantía de interoperabilidad:

| Familia | ZaiRuntime propio | Pi embebido | OpenCode empaquetado |
|---|---|---|---|
| Chat, streaming, herramientas | Implementar normalización y bucle | Núcleo listo | Motor listo por HTTP/SSE |
| Archivos, búsqueda, terminal | Herramientas propias con validación | Sustituir/envolver herramientas | Herramientas del motor con políticas |
| Navegador conectado y cable | Reutilizar broker de Zai | Adaptador MCP o herramientas Zai | Configurar MCP del broker |
| Skills e instrucciones | Descubrimiento/carga progresiva propios | ResourceLoader y skills disponibles | Descubrimiento compatible disponible |
| Sesiones, ramas, compacción | Implementar y probar | Disponible | Disponible |
| Permisos gráficos | Reutilizar UI, ampliar motor | Implementarlos en Zai | Traducir eventos/respuestas |
| Sandbox real | Trabajo específico por SO | No viene incluido | No asumir que reglas de permiso equivalen a sandbox |
| Subagentes y plan | Implementar scheduler y políticas | Extensión propia | Funciones disponibles |
| Hooks y plugins | Esquema Zai y confianza explícita | Extensiones/eventos, no contrato idéntico Claude | Plugins/eventos, no contrato idéntico Claude |
| Checkpoints y git | Capturar cambios y revisión propia | Añadir extensión/gestión propia | Revert/diff disponibles; validar semántica exacta |
| Servicios exclusivos Claude | No portar como si fueran locales | No aporta acceso | No aporta acceso |

Bases: [Pi SDK](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md), [Pi límites](https://github.com/earendil-works/pi), [OpenCode server](https://opencode.ai/docs/server/), [Claude SDK](https://code.claude.com/docs/en/agent-sdk/overview).

- Para el primer motor propio limitaría el alcance a archivos/búsqueda, terminal con aprobación, navegador conectado, skills, historial persistente y cancelación real. Compacción, subagentes, hooks y checkpoints deberían añadirse como funciones verificadas separadamente. [Base: separación de mecanismos Claude](https://code.claude.com/docs/en/features-overview).
- Un modo de solo lectura debe bloquear también shell capaz de escribir y herramientas MCP mutantes; no basta con quitar `write_file`. Ni `cwd` ni un prompt constituyen aislamiento. [Base: seguridad Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/security.md), [permisos Claude](https://code.claude.com/docs/en/permissions).
- Para checkpoints propios es preferible mostrar diff y restaurar solo archivos capturados, detectando cambios posteriores. Hacer `git reset --hard` a todo el proyecto podría destruir trabajo ajeno y no es un sustituto aceptable. [Base: límites de checkpoints](https://code.claude.com/docs/en/checkpointing).

### Gaps
- No hay una especificación pública universal que defina paridad completa con Claude Code. No se investigó todo el catálogo de funciones administradas, cuentas, nube o experimentales de Anthropic.
- No se probó un sandbox idéntico en Windows, Fedora y macOS. Un control de permiso de aplicación se debe describir como tal hasta contar con una barrera real del SO.

## ¿Qué licencias y restricciones de empaquetado afectan a Windows, Fedora y macOS?

### Takeaway
Pi y OpenCode permiten redistribución bajo MIT conservando avisos; Vercel AI SDK actual usa Apache-2.0. Zai puede incluir un núcleo Node usando el runtime de Electron y evitar instalaciones de CLI por el usuario; un motor OpenCode necesita binarios correspondientes al sistema. Licencias de dependencias y términos de proveedores se conservan separadamente. [Pi LICENSE](https://github.com/earendil-works/pi/blob/main/LICENSE), [OpenCode LICENSE](https://github.com/anomalyco/opencode/blob/dev/LICENSE), [AI SDK LICENSE](https://github.com/vercel/ai/blob/main/LICENSE), [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process).

### Cited Findings
- La licencia raíz de Pi es MIT; autoriza uso, modificación y distribución conservando el aviso de copyright y permiso. — [LICENSE Pi](https://github.com/earendil-works/pi/blob/main/LICENSE).
- OpenCode también publica licencia MIT con conservación de avisos. No implica que sus servicios alojados sean gratuitos ni que sus marcas puedan atribuirse como propias. — [LICENSE OpenCode](https://github.com/anomalyco/opencode/blob/dev/LICENSE).
- La licencia actual de Vercel AI SDK es **Apache-2.0**, no MIT. — [LICENSE oficial](https://github.com/vercel/ai/blob/main/LICENSE), [metadatos npm](https://registry.npmjs.org/ai/latest).
- Versiones consultadas el 16 de octubre de 2026: Pi y sus paquetes de núcleo `1.3.0`; paquete histórico `@mariozechner/pi-coding-agent` `0.73.1`; OpenCode runtime/SDK `1.19.3`; AI SDK `7.0.143`; MCP TypeScript SDK `1.32.1` MIT. — [Pi coding-agent metadata](https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest), [Pi anterior](https://registry.npmjs.org/@mariozechner%2fpi-coding-agent/latest), [OpenCode](https://registry.npmjs.org/opencode-ai/latest), [SDK](https://registry.npmjs.org/@opencode-ai%2fsdk/latest), [AI](https://registry.npmjs.org/ai/latest), [MCP](https://registry.npmjs.org/@modelcontextprotocol%2fsdk/latest).
- Pi coding-agent 1.3.0 es ESM y requiere Node >=22.19. Incluye recursos WASM, temas y otros assets; no basta copiar únicamente el entrypoint. — [package.json versión 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/package.json).
- El paquete `opencode-ai` distribuye paquetes opcionales por plataforma: Linux x64/arm64 con variantes musl, macOS x64/arm64 y Windows x64/arm64; existen variantes baseline x64. — [Metadatos publicados](https://registry.npmjs.org/opencode-ai/latest).
- Electron `utilityProcess.fork()` ejecuta un módulo con Node y MessagePorts desde el proceso principal, con `cwd`, entorno y stdio configurables; debe iniciarse después de `app.ready`. No es un sandbox de herramientas por sí mismo. — [Documentación Electron](https://www.electronjs.org/docs/latest/api/utility-process).
- OpenCode escucha por defecto en loopback y permite proteger el servidor con `OPENCODE_SERVER_PASSWORD`/usuario HTTP Basic. — [Servidor OpenCode](https://opencode.ai/docs/server/).
- Claude Agent SDK se rige por términos comerciales. Su documentación limita cómo terceros ofrecen autenticación/quotas de claude.ai y exige identidad de producto propia; por ello no debe tomarse su licencia como permiso para redistribuir libremente cualquier binario o servicio de Claude. — [License/auth/branding Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

### Inferences
- Paquete recomendado: código Zai y dependencias fijadas en lockfile dentro del instalador; `utilityProcess` para el motor; frontend solo recibe eventos y decisiones de aprobación. No hace falta `npm install -g` en la máquina del usuario. Deben probarse los assets y módulos nativos en cada plataforma. [Base: Electron](https://www.electronjs.org/docs/latest/api/utility-process), [Pi assets](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/package.json).
- Para OpenCode, usar binario fijado por arquitectura fuera de `app.asar`, iniciar con ruta absoluta, puerto aleatorio local y contraseña efímera. Conectar el SDK y terminar todo proceso propio al cerrar Zai. No depender de PATH ni ejecutar un instalador remoto en cada inicio. [Base: launcher SDK](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/sdk/js/src/server.ts), [auth servidor](https://opencode.ai/docs/server/).
- El runtime y los pesos locales son decisiones distintas. Incluir el harness no descarga Ollama, ComfyUI ni modelos de varios GB. Para Ollama Cloud se puede evitar instalación local mediante su API directa. [Base: Cloud oficial](https://docs.ollama.com/cloud).
- Añadir un inventario de dependencias y avisos de terceros al instalador es más claro que presentar toda dependencia como código original de Zai. Las bibliotecas no requieren copiar sus fuentes en nuestra app. [Base: MIT Pi](https://github.com/earendil-works/pi/blob/main/LICENSE), [MIT OpenCode](https://github.com/anomalyco/opencode/blob/dev/LICENSE), [Apache-2.0 AI](https://github.com/vercel/ai/blob/main/LICENSE).

### Gaps
- No se hizo auditoría transitiva completa de licencias ni certificación legal de redistribución. Antes de incluir binarios, revisar exactamente el artefacto fijado y sus notices.
- No se empaquetó ni lanzó Pi/OpenCode dentro de Zai durante esta investigación. Electron tiene Node incorporado, pero se debe comprobar la versión real y funcionamiento de ESM/WASM/assets de la dependencia elegida.
- Las variantes Windows nativas y la funcionalidad shell dependen del motor y utilidades disponibles; no asumir Bash, Git o ripgrep instalado sin incluirlo o detectarlo.

## ¿Cuál es una arquitectura concreta que aprovecha el Zai existente?

### Takeaway
Mantener los adaptadores Codex/Claude y añadir **Zai Agent** como tercer tipo de agente, separado del proveedor/modelo seleccionado. Así el usuario elige DeepSeek/OpenRouter/Ollama sin que aparezcan como imitaciones de Claude. La frontera de ejecución y conexión al navegador debe permanecer dentro del proceso de confianza de Zai. [Base: configuración de modelos/herramientas independiente en Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md), [Electron procesos](https://www.electronjs.org/docs/latest/api/utility-process).

### Cited Findings
- El workspace actual ya tiene un gestor de sesiones con adaptadores Codex/Claude y eventos normalizados de texto, herramientas, aprobaciones y estado. — [agents.cjs local](/home/yordi/Documentos/projects/zai/electron/agents.cjs).
- Ya existe un broker de navegador con credenciales por agente, grafo de conexiones y eventos reales de actividad; puede seguir siendo autoridad para aceptar/rechazar acciones. — [browser-hub.cjs local](/home/yordi/Documentos/projects/zai/electron/browser-hub.cjs), [main.cjs local](/home/yordi/Documentos/projects/zai/electron/main.cjs).

### Inferences
Diseño propuesto; los nombres son módulos nuevos de Zai, no APIs externas existentes:

1. **AgentHost**: crea un motor por sesión/proyecto, aborta HTTP y procesos al detenerse, publica eventos con identificador estable. Se ejecuta en `utilityProcess`; no se le entrega el entorno completo del usuario. [Base: utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process).
2. **ProviderAdapter**: streaming y descubrimiento de modelos, claves en memoria del proceso de confianza, `baseUrl` validada, capacidades por modelo y medición de tokens. Adaptadores OpenAI-compatible y Ollama nativo cubren gran parte del alcance; no deben normalizar ciegamente todos los campos de razonamiento. [Base: modelos Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), [streaming herramientas Ollama](https://docs.ollama.com/capabilities/tool-calling).
3. **ToolBroker**: schemas estrictos, validación de argumentos, lectura/escritura atómica, búsqueda acotada, shell con límites y cancelación, herramientas MCP del navegador existente. Cada ejecución consulta política de permisos fuera del modelo. Los resultados grandes se truncan conservando archivo de salida cuando haga falta. [Base: contratos de herramientas/extensiones Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md).
4. **SkillRegistry**: directorios Zai y `.agents/skills`, índice de nombres/descripciones, carga de `SKILL.md` bajo demanda; mostrar requisitos y procedencia. No ejecutar scripts/hooks solo por haber leído una skill. [Base: mecanismos separados](https://code.claude.com/docs/en/features-overview), [skills OpenCode](https://opencode.ai/docs/skills/).
5. **SessionStore**: diario append-only de mensajes, llamadas/resultados, decisiones, cambios de modelo y límites de contexto; guardar por sesión fuera del JSON de posiciones del tablero. La compacción cambia el contexto enviado, no elimina el historial auditable. [Base: sesiones Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sessions.md).
6. **Scheduler futuro**: límites de pasos/coste, reintentos acotados, árbol de subagentes con cancelación heredada, presupuesto y permisos reducidos, bloqueo de operaciones concurrentes sobre un mismo archivo/navegador. [Base: subagentes Claude](https://code.claude.com/docs/en/sub-agents), [eventos concurrentes Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md).
7. **Pruebas mínimas**: mock de streaming/tool-call con deltas parciales; negar escritura fuera del proyecto y rutas symlink; aprobación única; cancelación de shell/HTTP; sesión reanudada; desconexión del cable revoca acceso; error/429 no duplica acciones; modelo sin tools permanece como chat. Estos son criterios propuestos, no pruebas ya ejecutadas. [Base: seguridad Pi](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/security.md), [contrato de herramientas Ollama](https://docs.ollama.com/capabilities/tool-calling).

### Gaps
- Esta investigación no implementa estos módulos ni verifica la paridad. La aplicación puede entregar un primer Zai Agent útil y declarar por separado qué familias ya están implementadas.
- Falta determinar si el primer release usará un bucle completamente propio o Pi como motor detrás de la interfaz. Ambas rutas comparten el broker y la UI propuestos.

# Arquitectura de Zai

Zai es una aplicación de escritorio escrita desde cero en Electron, React y TypeScript.
T3 Code se consultó como referencia para entender su separación entre proveedores e interfaz.
No se copió ni se incorporó código de ese proyecto.

```mermaid
flowchart LR
  UI[React: proyectos y pizarra] --> Bridge[Preload: API limitada]
  Bridge --> Main[Proceso principal de Electron]
  Main --> Codex[Conector propio: Codex App Server]
  Main --> Claude[Conector propio: Claude Agent SDK]
  Main --> PTY[Terminal del proyecto]
  Main --> Disk[workspace.json local]
  Codex --> CCLI[Codex CLI instalado]
  Claude --> ACLI[Claude Code instalado]
  UI --> Browser[Chromium aislado por proyecto]
```

## Conectores de agentes

`electron/agents.cjs` contiene los dos conectores. Traducen sus protocolos a eventos
de mensajes, sesiones, herramientas, estados, errores y permisos.

Codex se inicia mediante `codex app-server --listen stdio://`. El conector completa
`initialize` y `initialized`, crea o reanuda un hilo y envía cada mensaje con
`turn/start`. Los eventos se leen como JSON por líneas. Las solicitudes de permiso
esperan una decisión del usuario; una aprobación concede una operación, no acceso
permanente. Se conserva el identificador del hilo para reanudarlo.

Claude usa `query()` del SDK oficial y el ejecutable instalado de Claude Code.
Cada turno recibe eventos estructurados y conserva su identificador de sesión para
continuar la conversación. `canUseTool` lleva los permisos a la ventana del chat.
Detener un turno cancela su consulta.

Los proveedores usan la autenticación que ya maneja su CLI. Zai no lee ni copia sus
archivos de credenciales. No reemplaza sus modelos por uno fijo: por defecto usa la
configuración del proveedor y permite indicar un modelo en cada ventana.

### Modelos, esfuerzo, velocidad y uso

`electron/providers.cjs` consulta un catálogo compartido por proveedor, sin enviar
prompts ni crear hilos de trabajo. Codex expone `model/list`, `config/read` y
`account/rateLimits/read`. Se usan los esfuerzos y `serviceTiers` de cada fila;
`turn/start` recibe `model`, `effort` y `serviceTier` en cada turno. Volver a la
velocidad estándar envía `default` explícitamente para evitar heredar el modo rápido.

Claude expone modelos y capacidades mediante `initializationResult()` del Agent
SDK. Cada consulta recibe `model`, `effort` y una capa de ajustes de sesión
`settings.fastMode`; no se modifican los ajustes del usuario. El estado de fast
mode informado por el agente permite mostrar sus pausas y cambios a velocidad
estándar. Los modelos sin capacidad anunciada no ofrecen ese control.

Los límites de Claude se consultan, si existe, mediante el control opcional
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true})`.
Es una API experimental: se comprueba su presencia, se limita el tiempo de espera
y se admite que falte o falle. Los eventos `rate_limit_event` complementan los
datos durante el chat. No se leen tokens ni se llaman endpoints privados para
suplir su ausencia. Una conexión por API puede no exponer cuota de cuenta.

Los periodos se derivan de las ventanas que informa cada proveedor, sin asumir
que la ventana principal siempre dura cinco horas. Los datos ausentes no se
convierten en cero. Las cuotas se mantienen en memoria, se actualizan cada dos
minutos con la app visible, al terminar un turno y con el botón de actualización.
Las notificaciones parciales se combinan con las ventanas ya conocidas. Los
tokens y el coste estimado de una conversación se muestran por separado.

### Secuencia del chat

Cada chat guarda un `timeline` de referencias a mensajes y acciones. El primer
evento añade una entrada; los deltas, resultados y cambios de estado actualizan
esa entrada sin moverla. Los bloques de texto de Claude tienen identificadores
independientes para poder intercalar herramientas y texto. Los argumentos de una
herramienta se completan en su tarjeta original, y el resultado final permanece
en su posición posterior a las acciones que lo precedieron. La secuencia y los
resultados de herramientas se conservan al reiniciar; las acciones que quedaron
activas se muestran interrumpidas tras restaurar el archivo.

## Proyectos y ventanas

Cada proyecto guarda su carpeta, ventanas, notas, conversación, zoom y posición de
la pizarra. Los proyectos comparten el proceso de escritorio, y cada chat tiene una
instancia independiente de su proveedor. Minimizar y cambiar de proyecto oculta
los componentes sin desmontarlos. Las sesiones siguen activas hasta cerrar su
ventana o salir de la aplicación.

La capa transformada de ventanas tiene su propio contexto de apilamiento, por
encima del título del proyecto y por debajo de los controles de la pizarra. La
barra superior reúne las ventanas minimizadas de todos los proyectos. Restaurar
desde esa lista cambia al proyecto correspondiente, lleva la ventana al frente
y centra el área visible en ella sin desmontar el componente.

La distribución y los mensajes se guardan en `workspace.json`, en el directorio
`userData` de Electron. La escritura se serializa y utiliza un archivo temporal y
un cambio de nombre. Los controles flotantes y la apariencia también se guardan.
El registro de actividad está limitado a 150 entradas.

Las copias importadas crean identificadores nuevos y eliminan las referencias a
sesiones y carpetas. Así no se conectan a una conversación ajena ni ejecutan agentes
en una ruta procedente del archivo importado.

## Navegador y límites de procesos

El navegador usa un `webview` de Electron para integrarse en la composición y el
orden de las ventanas del lienzo. Solo permite HTTP y HTTPS. Cada proyecto tiene
una partición de sesión persistente. El proceso principal impone sandbox,
aislamiento de contexto y ausencia de integración con Node; los sitios no reciben
el puente de Zai. Se conservan las protecciones de seguridad del navegador.
Las ventanas emergentes de autenticación utilizan ventanas de navegador aisladas.

Los procesos de agentes, las terminales y el almacenamiento pertenecen al proceso
principal. El renderer solo recibe una API concreta en `electron/preload.cjs`.
El proceso principal valida el emisor de cada llamada. Cerrar una ventana termina
su agente o terminal; salir termina los procesos que aún pertenecen a Zai.

## Referencias de protocolo

- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Fast mode de Claude Code](https://code.claude.com/docs/en/fast-mode)
- [Referencia TypeScript del SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Arquitectura de T3 Code](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md)

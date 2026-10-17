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

## Proyectos y ventanas

Cada proyecto guarda su carpeta, ventanas, notas, conversación, zoom y posición de
la pizarra. Los proyectos comparten el proceso de escritorio, y cada chat tiene una
instancia independiente de su proveedor. Minimizar y cambiar de proyecto oculta
los componentes sin desmontarlos. Las sesiones siguen activas hasta cerrar su
ventana o salir de la aplicación.

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
- [Arquitectura de T3 Code](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md)

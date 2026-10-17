# zai.

**Tus agentes, herramientas e ideas. En el mismo lugar.**

Una pizarra de escritorio con un espacio independiente para cada proyecto.
Abre chats de Codex y Claude, un navegador, terminales y notas; mueve las ventanas
a tu gusto o conviértelas en iconos sin detener sus sesiones.

![Pizarra de Zai](docs/assets/zai-preview.png)

## Lo que incluye

- Chats propios de Codex y Claude con respuestas en streaming, Markdown, herramientas,
  errores y solicitudes de permiso. Conexión a los agentes locales mediante sus
  interfaces oficiales.
- Selectores de modelo, esfuerzo y velocidad por chat, consultados a cada agente.
  Menús con búsqueda de modelos, descripciones, selección por teclado y adaptación
  al espacio disponible. Límites de cuenta con porcentajes y reinicios cuando el proveedor los publica.
- Permisos nativos por chat: acceso a archivos, aprobaciones y red en Codex;
  modos de permisos de Claude, incluida la aceptación de ediciones y planificación.
- Conexiones entre chats y navegadores mediante puntos que puedes arrastrar.
  Los agentes pueden leer y controlar los navegadores conectados con herramientas
  MCP propias. El hilo muestra pulsos al realizar acciones y devolver resultados.
- Mensajes y herramientas en secuencia cronológica, conservada al reabrir la app.
- Ventanas movibles y redimensionables, ampliación, iconos movibles y organización
  automática. La barra superior reúne todas las ventanas minimizadas y permite
  restaurarlas, incluso desde otro proyecto o fuera del área visible. Los borradores y las páginas permanecen abiertos al minimizar.
- Proyectos con carpeta, conversaciones y distribución independientes. Cambiar de
  estancia mantiene los agentes activos.
- Navegador Chromium integrado, navegación atrás y adelante, recarga y herramientas
  de desarrollo. Las páginas están aisladas del acceso a Node y a la API de Zai.
- Terminal real en la carpeta del proyecto y notas editables.
- Registro de actividad, guardado local, exportación e importación de copias.
- Tema claro y oscuro, colores de acento, panel de proyectos y barra movibles,
  pizarra con desplazamiento y zoom y buscador de acciones.

## Ejecutar

Necesitas Node.js 24 y las CLI de los agentes que quieras utilizar. La interfaz
funciona sin ellas; los chats requieren instalar e iniciar sesión en su proveedor.

```sh
npm ci
npm run dev
```

Para abrir la compilación de producción:

```sh
npm run build
npm start
```

Para usar Codex, instala [Codex CLI](https://developers.openai.com/codex/cli/) y
ejecuta `codex login`. Para Claude, instala
[Claude Code](https://code.claude.com/docs/en/overview) y ejecuta `claude auth login`.
Zai utiliza sus sesiones locales y no requiere una clave API propia.

Dentro de Zai, vincula la carpeta de un proyecto y escribe en un chat. El selector
de modelo ofrece el catálogo de la CLI o un identificador personalizado. También
puedes elegir esfuerzo y velocidad cuando el modelo los admita. El modo rápido
puede consumir más cuota o tener un coste mayor. En «Uso» se muestran únicamente
los periodos publicados por la cuenta (5 horas, semanal, mensual u otros), con
su porcentaje y fecha de reinicio. Algunas conexiones por API o proveedores
personalizados no exponen estos límites; Zai lo indica y muestra el consumo de
la conversación cuando el agente lo informa.
Las operaciones que el proveedor someta a aprobación aparecerán en el chat.

El icono de escudo abre «Permisos». Codex permite elegir solo lectura, escritura
en el proyecto o acceso completo, junto con su política de aprobaciones y acceso
a red de los comandos. Claude ofrece sus modos nativos de aprobación. Las opciones
se aplican al siguiente turno y quedan guardadas en ese chat.

Para conectar un navegador, arrastra uno de los puntos de su cabecera hasta un
punto de Codex o Claude en el mismo proyecto. También puedes pulsar ambos puntos
con el ratón o con Enter. Pide al agente que use el navegador conectado: puede
navegar, leer la página, pulsar elementos, escribir en campos, elegir opciones,
enviar teclas, desplazarse y tomar capturas. El acceso del navegador se configura
por separado en «Permisos»: solo lectura, preguntar por cada interacción o control.
Los modos de solo lectura de Codex y Plan de Claude impiden modificar el navegador.
Los pulsos del hilo corresponden a acciones reales, incluso al minimizar la ventana.
La lectura sigue disponible al minimizar; para tomar capturas, restaura el navegador
y mantén visible su proyecto en la pizarra.
Para desconectar, selecciona el hilo y pulsa Supr/Backspace o su botón de desconexión.
Desconectarlo revoca el acceso del agente a ese navegador.

`npm run dev:web` abre la vista previa en `http://127.0.0.1:4317`. En ese modo puedes
probar la pizarra y el guardado en el navegador; los agentes, las carpetas, la
terminal y el navegador integrado necesitan Electron.

## Sistemas y paquetes

La aplicación usa Electron y tiene configuración de empaquetado para:

| Sistema | Paquete |
| --- | --- |
| Linux, incluido Fedora | AppImage y RPM |
| Windows | Instalador NSIS |
| macOS | DMG |

```sh
npm run dist
```

Construye en el sistema de destino para compilar sus dependencias nativas.
Los paquetes aparecen en `release/`. La firma de distribución de Windows y macOS
requiere configurar certificados propios; no se incluyen certificados en el repo.

Si Fedora no tiene FUSE 2, puedes abrir el AppImage sin instalarlo utilizando el
modo de extracción, también probado con el navegador y la terminal:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./release/Zai-0.3.2.AppImage
```

La versión inicial se ha probado localmente en Fedora. El workflow de CI está
preparado para verificar compilación, interfaz, Electron y empaquetado en Linux,
Windows y macOS. Esto no sustituye pruebas manuales en los tres sistemas.

En Fedora, la compilación de `node-pty` puede necesitar `gcc-c++`, `make` y Python.
Para generar RPM instala también las herramientas de RPM de tu sistema.

## Atajos

| Acción | Atajo |
| --- | --- |
| Buscar acciones | Ctrl K / ⌘ K |
| Mover la pizarra | Espacio + arrastrar, H o botón central |
| Seleccionar | V |
| Encuadrar ventanas | F |
| Nueva nota | N |
| Zoom | Ctrl / ⌘ + rueda |
| Enviar / nueva línea | Enter / Shift Enter |

## Validación

```sh
npm run check
npm run test:unit
npx playwright install chromium
npm test
npm run build
npm run test:desktop
npm run test:providers
```

En Linux sin sesión gráfica, ejecuta la prueba de escritorio con
`xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:desktop`.
Las pruebas automáticas usan perfiles y carpetas temporales. La prueba de protocolos
inicia las CLI sin enviar un prompt ni pedir una inferencia.

También se verificó una respuesta real de ambos agentes usando los conectores de
Zai, sin solicitar herramientas ni modificaciones de archivos.

Consulta [la arquitectura](docs/architecture.md) para los protocolos y la
separación entre interfaz y procesos. T3 Code se consultó como referencia de
arquitectura; esta implementación se escribió desde cero, sin incorporar código
de ese proyecto.

## Licencia

Proyecto de [Yordi (Y0RD1N)](https://github.com/Y0RD1N), distribuido bajo la
[licencia MIT](LICENSE). Al reutilizar copias o partes sustanciales del código,
se deben conservar su aviso de copyright y de licencia. Las dependencias conservan
sus respectivas licencias.

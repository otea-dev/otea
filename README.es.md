<h1 align="center">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/images/otea-logo-dark.svg">
<img src="docs/images/otea-logo-light.svg" alt="Otea · inicio rápido" width="116" height="161">
</picture><ruby><rp>Otea · inicio rápido</rp></ruby>
<br>
<a href="https://www.npmjs.com/package/@otea/cli"><img src="https://img.shields.io/npm/v/@otea/cli?label=npm&color=2d54d3" alt="versión en npm"></a>
<a href="https://github.com/otea-dev/otea/releases/latest"><img src="https://img.shields.io/github/v/release/otea-dev/otea?label=descargar&color=2d54d3" alt="Última versión"></a>
<a href="https://github.com/otea-dev/otea/actions/workflows/ci.yml"><img src="https://github.com/otea-dev/otea/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="Licencia: AGPL-3.0"></a>
<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.18-339933" alt="Node &gt;=22.18"></a>
</h1>

> Del verbo *otear*: mirar desde lo alto lo que pasa y lo que viene.

**Otea es el lugar donde tú y tus agentes de IA se pasan el trabajo.** Los agentes dejan lo que hicieron, con su evidencia; tú dejas decisiones y comentarios. En cada momento se ve en qué está cada cosa y a quién le toca. Tus datos se quedan en tu proyecto: sin nube y sin cuentas.

Esta es la guía corta en español: instalar y empezar a usar Otea. Todo lo demás está en el [README en inglés](README.md) y en [`docs/`](docs/) (ver [Más información](#más-información)).

## Empezar en un minuto

En la carpeta que quieres seguir, normalmente un repositorio:

```sh
npm i -g @otea/cli   # necesita Node.js 22.18 o posterior
otea start
```

`otea start` crea el proyecto, abre el escritorio en tu navegador e imprime el texto que le pegas a tu agente (el [paso 2](#2-crear-el-proyecto) lo explica). ¿Sin Node, o prefieres Otea en su propia ventana? Instala la app de escritorio: la sección siguiente tiene las dos formas.

## 1. Instalar

Hay dos formas de instalar Otea: la **app de escritorio** o el **comando `otea` desde npm**. Las dos son el mismo Otea, con los mismos tableros, el mismo teléfono y los mismos agentes.

**¿Cuál elijo?**

- **Windows:** la app de escritorio. Se instala con un clic, se actualiza sola y deja `otea` en tu terminal.
- **macOS:** la app de escritorio, si quieres Otea en su propia ventana y con avisos. Todavía no se actualiza sola: cada versión nueva la descargas tú. Si ya usas Node, npm sirve igual.
- **Linux:** la app de escritorio en `.deb` si usas Debian o Ubuntu. En otras distribuciones, el AppImage, o npm si quieres `otea` en tu terminal.

### Qué te da cada una

| | App de escritorio | npm (`npm i -g @otea/cli`) |
| --- | --- | --- |
| Cómo abres Otea | Su propia ventana, desde el ícono de la app | Una pestaña del navegador, después de `otea serve` en una terminal |
| Ícono en la bandeja o la barra de menús | ✅ Muestra lo que te espera; al cerrar la ventana sigue corriendo | ❌ |
| Número en la barra de tareas o el Dock | ✅ Windows y macOS · ❌ Linux | ❌ |
| Avisos en esta computadora | ✅ Los del sistema | ❌ |
| Actualizaciones | ✅ Windows · ✅ Linux (el `.deb` te pide tu contraseña) · macOS: te avisa y la descargas tú | A mano: `npm i -g @otea/cli` otra vez |
| `otea` en tu terminal | ✅ Windows y `.deb` · macOS: un clic en la barra de menús · ❌ AppImage | ✅ |
| Necesita Node.js | ❌ Trae el suyo | ✅ Node.js 22.18 o posterior |

Todo lo demás funciona igual de las dos formas: los tableros, el teléfono (emparejarlo y recibir avisos en él) y los agentes por la terminal o por MCP. Ninguna de las dos arranca sola al iniciar sesión.

### La app de escritorio

Descarga el instalador de tu sistema desde la [última versión](https://github.com/otea-dev/otea/releases/latest):

| Sistema | Archivo |
| --- | --- |
| Windows | `Otea-Setup-<versión>.exe` |
| macOS (Apple silicon e Intel) | `Otea-<versión>-mac.dmg` |
| Linux, Debian o Ubuntu | `Otea-<versión>-amd64.deb` |
| Linux, cualquier otra | `Otea-<versión>-x86_64.AppImage` |

Los instaladores todavía no están firmados: Otea es un proyecto de código abierto que aún no tiene un certificado de firma de pago. Tu sistema te avisa la primera vez; así lo pasas.

**Windows.**

1. Tu navegador puede avisarte de la descarga antes de que puedas abrirla. En **Edge** (pide confirmar que confías en `Otea-Setup-…`), haz clic en la flecha junto a **Eliminar**, luego en **Conservar**; si te lo vuelve a pedir, en **Mostrar más** y después en **Conservar de todos modos**. **Chrome** muestra un aviso parecido (un archivo que casi nadie descarga): abre el menú de la descarga y elige **Conservar** (o **Conservar archivo peligroso**).
2. Abre el `.exe`. Si aparece una ventana azul que dice «Windows protegió su PC», haz clic en **Más información** y después en **Ejecutar de todos modos**. Otea se instala solo para ti (no hace falta ser administrador) y se abre.

**macOS.** Abre el `.dmg` y arrastra Otea a Aplicaciones. Abre Otea: macOS dice que no puede comprobarlo. Haz clic en **Listo** (o **OK**), abre **Configuración del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre Otea y haz clic en **Abrir igualmente**. Confirma y Otea se abre; desde entonces se abre como cualquier app. Para tener `otea` en tu terminal, haz clic en el ícono de Otea en la barra de menús y elige **Instalar el comando otea**. Por ahora las actualizaciones son a mano: cuando sale una versión nueva, Otea te avisa, y tú la descargas y la arrastras otra vez a Aplicaciones.

**Linux, `.deb`.** En una terminal, en la carpeta del archivo:

```sh
sudo apt install ./Otea-*.deb
```

Así Otea queda en el menú de aplicaciones y `otea` en tu terminal.

**Linux, AppImage.** En una terminal, en la carpeta del archivo:

```sh
chmod +x Otea-*.AppImage
./Otea-*.AppImage
```

### Comprobar la descarga

Cada versión trae un `SHA256SUMS.txt` con la huella de cada instalador. Si la huella de tu archivo coincide con su línea, es el archivo que publicó la versión. Descarga `SHA256SUMS.txt` en la misma carpeta y después:

- **Windows** (PowerShell): `Get-FileHash .\Otea-Setup-*.exe` muestra la huella. Busca el mismo texto en `SHA256SUMS.txt` (no importan mayúsculas o minúsculas).
- **macOS** (Terminal): `shasum -a 256 Otea-*-mac.dmg` muestra la huella. Busca el mismo texto en `SHA256SUMS.txt`.
- **Linux**: `sha256sum -c --ignore-missing SHA256SUMS.txt` revisa los archivos que tienes y dice `OK` (o `La suma coincide`) para cada uno.

### El comando `otea` desde npm

Necesitas [Node.js](https://nodejs.org/) 22.18 o posterior (se recomienda Node 24). Compruébalo con `node --version`. Después:

```sh
npm i -g @otea/cli
otea --version
```

Para actualizar, corre `npm i -g @otea/cli` otra vez. Para quitarlo, `npm uninstall -g @otea/cli`. Con el comando de npm, el escritorio lo abres con `otea serve` (paso 3).

### Desde el código

Para trabajar en Otea, o para correr lo que aún no se publicó. Si solo quieres usar Otea, la app de escritorio o npm, arriba, es más simple. Necesitas Git y Node.js 22.18 o posterior (se recomienda Node 24).

```sh
git clone https://github.com/otea-dev/otea.git
cd otea
npm ci              # las dependencias del comando
npm run build:ui    # la página web que muestra otea serve
npm link            # deja el comando otea disponible en tu terminal
otea --version
```

`npm link` instala un comando de verdad, así que también lo encuentra la terminal de tu agente. Si `otea` no aparece, `npm prefix -g` te dice dónde quedó: agrega esa carpeta a tu PATH (en macOS y Linux, su `bin`). Para actualizar, corre `git pull`, `npm ci` y `npm run build:ui` otra vez. Para armar la app de escritorio desde el código, mira [`desktop/README.md`](https://github.com/otea-dev/otea/blob/main/desktop/README.md) (en inglés).

## 2. Crear el proyecto

Elige la carpeta que quieres seguir, normalmente un repositorio. Crear el proyecto no escribe nada en el repositorio, y empieza sin tableros. Cuando tu agente ejecuta `otea connect` (o tú `otea init --agents-md`), Otea añade a `AGENTS.md` un bloque marcado entre `<!-- otea:begin -->` y `<!-- otea:end -->`, que solo apunta a `otea board`; `otea hook install --git` escribe el hook de push. `otea uninstall` lo quita todo (`--dry-run` lista antes cada repo y archivo que tocaría) y no borra tus datos salvo con `--purge-data`.

- **Si usas la app de escritorio:** ábrela. La primera vez te pide abrir un proyecto: **Abrir carpeta** (si la carpeta todavía no es un proyecto, la app te pregunta si lo creas ahí) o **Crear proyecto** (para una carpeta nueva). Si la carpeta está dentro de un repositorio de git, la app te ofrece crear el proyecto para todo el repositorio. No hace falta `otea init`: la app lo hace por ti. Las próximas veces, Otea reabre tu último proyecto; **Cambiar de proyecto…**, en el ícono de la bandeja o de la barra de menús, vuelve a mostrar la lista.
- **Si usas la terminal (npm o código):** en la carpeta de tu proyecto, un solo comando hace los primeros minutos:

  ```sh
  otea start    # crea el proyecto, abre el escritorio y te da el texto para tu agente
  ```

  Crea el proyecto si no existe, deja el escritorio andando en segundo plano y lo abre en tu navegador (`--no-open` imprime el enlace en su lugar), te ofrece un primer tablero a partir de una plantilla (`--template <clave>`; sin ella, tu agente los diseña contigo) e imprime el texto que le pegas a tu agente, con el servidor MCP que él agrega. Puedes correrlo otra vez cuando quieras: no cambia nada de lo que ya existe y te dice qué había. Es para ti: un agente nunca lo ejecuta.

## 3. Abrir el escritorio

- **Si usas la app de escritorio:** ya está abierto, en la ventana de la app. No hace falta `otea serve`.
- **Si usas la terminal (npm o código):** `otea start` ya lo abrió. Si prefieres los pasos sueltos, `otea init` crea el proyecto y `otea serve` abre el escritorio en tu navegador hasta que pulses Ctrl+C.

Es tu escritorio: ahí revisas, apruebas y devuelves el trabajo de tus agentes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/demo-agent-loop-dark.gif">
  <img src="docs/images/demo-agent-loop-light.gif" alt="La página de un cambio en el escritorio: el agente tilda la lista (rama, diff, capturas), la ruta pasa de su carril al tuyo y la persona pulsa Aprobar. Leyenda en inglés: The agent does the steps. You only review.">
</picture>

**El agente hace los pasos; tú solo revisas.** Tilda la lista que pide el tablero, la ruta pasa de su carril al tuyo y a ti solo te queda aprobar.

## 4. Pegarle el texto a tu agente

`otea start` imprime el texto, y el escritorio vacío te lo ofrece con el botón **Copiar la instrucción** («Esto es para tu agente»; el texto completo está en **Detalles técnicos**). Con la app o con la terminal, es el mismo: cópialo y pégalo en el chat de tu agente (Claude Code, OpenCode, Codex o cualquier otro con terminal o MCP). Más tarde, el botón **Conectar un agente** vuelve a mostrarlo, y `otea prompt` imprime el mismo texto en la terminal.

Si usas la app, tu agente tiene que poder ejecutar `otea` en su terminal. Windows y el `.deb` de Linux lo dejan listo al instalar (abre una terminal nueva, o reinicia tu agente, después de instalar). En macOS, haz clic en el ícono de Otea en la barra de menús y elige **Instalar el comando otea**. El AppImage no lo deja: usa el `.deb` o npm.

Con ese texto, el agente se conecta solo, lee el proyecto y te hace unas preguntas para armar contigo sus tableros. Tú los pruebas y los publicas en Studio. Desde ahí, cada pedido pasa por un tablero, y tú revisas los pasos que el tablero te asigna.

Si trabajas directo en `main` y no quieres que nada se suba antes de verlo, pídele el tablero «Código en main». Al publicarlo, deja marcada la opción de instalar el hook de git de Otea (`otea hook install --git`): sin ese hook, git deja pasar un push antes de que lo apruebes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/demo-phone-answer-dark.gif">
  <img src="docs/images/demo-phone-answer-light.gif" alt="Un teléfono muestra la pregunta de un agente; la persona toca Responder, escribe y envía, y el escritorio pequeño a su lado muestra que la pregunta ya no está. Leyenda en inglés: Answer your agents from your phone.">
</picture>

**Responde a tus agentes desde el teléfono.** La pregunta de un agente te llega al teléfono; la respondes ahí y el escritorio muestra al agente siguiendo.

## En Windows, con Git Bash

Git Bash convierte en ruta un argumento que empieza con `/`. Otea lo corrige en los textos que recibe (un título, un campo, una nota), así que `otea create --title "/deploy falla"` conserva su barra. En cualquier otro caso, pon `MSYS_NO_PATHCONV=1` delante de ese comando o empieza el valor con `//`.

## Actualizar y quitar

**Actualizar.** Con npm, `npm i -g @otea/cli` otra vez; `otea --version` dice la versión que tienes. Una vez al día, cuando ejecutas `otea` en una terminal, pregunta al registro de npm si hay una versión nueva y, si la hay, imprime una línea. Nunca lo hace en CI, con `--json`, en una tubería, para un agente (`--as` u `OTEA_AGENT`), para el servidor MCP, el hook ni `otea uninstall`; espera como mucho un segundo y no dice nada sin conexión. `OTEA_NO_UPDATE_CHECK=1` lo apaga. La app de escritorio no hace esta comprobación: en Windows y en Linux (`.deb`) se actualiza sola; en macOS descargas cada versión. Tus proyectos, tableros e historial viven en la carpeta de Otea (`~/.otea`, o `$OTEA_HOME`), y actualizar no los toca.

**Qué escribe Otea en tu repo.** Un bloque en `AGENTS.md`, entre `<!-- otea:begin -->` y `<!-- otea:end -->`, que apunta a `otea board` (lo escriben `otea connect` y `otea init --agents-md`); el hook `pre-push` marcado `# otea-hook` (lo escribe `otea hook install --git`); y `.otea/` con una línea en `.git/info/exclude` (lo escribe `otea init --local`). `otea init` con el almacenamiento por omisión y la app de escritorio no escriben nada en el repo. Otea no escribe configuración de ningún arnés: si añadiste su servidor MCP a la configuración de un agente, quítalo allí.

**Quitar.** `otea uninstall --dry-run` lista cada repo y archivo que tocaría y no cambia nada; `otea uninstall` saca el hook y el bloque de `AGENTS.md` de cada repo y detiene el servidor en segundo plano. Quita solo lo que es exactamente de Otea: un hook que sea, línea por línea, uno de los que Otea escribió, y el bloque de `AGENTS.md` que Otea escribe, una vez, entre sus marcas. Un hook que editaste, otro hook de pre-push y el resto de `AGENTS.md` se quedan, y lo dice. No toca tus datos: para borrar también la carpeta de Otea y el `.otea/` del repo (sin vuelta atrás) añade `--purge-data`, que te pide escribir `yes` (`--yes` responde por un script). Después quita el comando: `npm uninstall -g @otea/cli`; en Windows, Configuración > Aplicaciones > Otea > Desinstalar; en macOS, arrastra Otea fuera de Aplicaciones; en Linux, `sudo apt remove otea-desktop` o borra el AppImage.

## Estado

Otea es temprana y cambia rápido, pero ya se puede usar. El [registro de cambios](https://github.com/otea-dev/otea/blob/main/CHANGELOG.md) (en inglés) dice qué cambió en cada versión, y la definición del producto está en [`docs/otea-product-definition.md`](docs/otea-product-definition.md) (en inglés).

## Por qué Otea, y cuándo no

Un gestor de tareas o un `TODO.md` guarda qué hay que hacer. Otea guarda también cómo, y lo comprueba:

- **El tablero es el procedimiento.** El agente lee las instrucciones de cada paso en el tablero (`otea next`), no en un texto que repites en cada sesión.
- **Cada entrega trae su evidencia.** El diff, las capturas, el resultado de las pruebas o la grabación vienen con el elemento, y los revisas ahí.
- **Una puerta controla lo que un agente puede subir.** El hook de git deja pasar una rama solo mientras el paso de su elemento lo permite, y una rama base que el tablero protege solo después de que apruebes.

Cuándo no usarlo:

- Trabajas en vivo con un solo agente y nunca te alejas: el chat ya es la entrega.
- Necesitas sincronización en la nube o cuentas: Otea es local primero y sus datos se quedan en tu computadora.
- Necesitas un instalador firmado: los instaladores de Otea todavía no están firmados.

## Ayuda

Las preguntas y los errores van a [GitHub Issues](https://github.com/otea-dev/otea/issues). Un problema de seguridad se informa en privado, como indica [SECURITY.md](SECURITY.md).

## Licencia

Otea es software libre bajo la [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Puedes usarlo, estudiarlo, modificarlo y compartirlo. Si distribuyes una versión modificada, o dejas que otras personas la usen por red, debes publicar su código fuente bajo la misma licencia y conservar los avisos de copyright.

**Uso dentro de una empresa.** Usar Otea, sin cambios o modificado, en los equipos de tu propio equipo de trabajo y para tu propio trabajo no te exige nada, siempre que no lo distribuyas ni lo ofrezcas como servicio de red a personas ajenas a tu organización. Las obligaciones de la AGPL empiezan cuando entregas copias a otros, o dejas que otros usen por red tu versión modificada. Es una lectura sencilla de la licencia, no asesoría legal: [SECURITY.md](SECURITY.md#using-otea-inside-a-company-the-agpl) (en inglés) tiene el detalle, y rige el texto de la [licencia](LICENSE).

**Licencia comercial.** Si la AGPL no te sirve para tu uso (por ejemplo, integrar Otea en un producto cerrado), hay una licencia comercial. Abre un issue o escribe a Federico Daniel Ara ([@Lartweib](https://github.com/Lartweib)).

**Nombre.** «Otea» y su logo identifican este proyecto. Los forks son bienvenidos bajo la AGPL, pero deben usar otro nombre.

Las contribuciones se aceptan bajo el [Acuerdo de Licencia de Colaborador](https://github.com/otea-dev/otea/blob/main/CLA.md) (CLA, en inglés); mira [CONTRIBUTING.md](https://github.com/otea-dev/otea/blob/main/CONTRIBUTING.md).

## Más información

Esta guía no traduce todo el README. Para los comandos de cada día, la referencia y los detalles, usa el [README en inglés](README.md) y la carpeta [`docs/`](docs/), que también está en inglés:

- [Trabajar con agentes](docs/working-with-agents.md): los comandos que ejecutan los agentes, la entrega de decisiones, la espera y qué pegar en el chat de un agente.
- [MCP](docs/mcp.md): trabajar desde un cliente MCP.
- [Proyectos](docs/projects.md): dónde vive un proyecto y cómo conectar varios repositorios.
- [Tableros](docs/boards.md): plantillas, tableros que se dividen en otros y los controles de git.
- [El escritorio](docs/desk.md): `otea serve` y la interfaz web.
- [Varios proyectos y un teléfono](docs/phone.md): un servidor para todos los proyectos, el teléfono y los avisos.
- [Seguridad y datos](docs/security.md): dónde guarda Otea sus datos, qué escucha y dónde, qué sale de la máquina, qué escribe en tus repos y cómo quitarlo.

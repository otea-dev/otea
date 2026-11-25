// What the person pastes into an agent's chat to start it on a project, in the language of the
// screen it is copied from. Three moments: a new project (the whole first contact: set up,
// connect, read the project, interview the person, draft its boards and say how to try them), one
// more board on a project that has boards, and one more agent joining the work already there,
// written from the project as it is now (its boards, their agent steps, what waits, who listens).
// Pure and browser-safe: the server, the CLI and the UI build the same words.
import type { Lang } from './board/template-words.ts';

export const PROMPT_KINDS = ['start', 'join', 'design'] as const;

export type PromptKind = (typeof PROMPT_KINDS)[number];

export function isPromptKind(kind: string): kind is PromptKind {
  return (PROMPT_KINDS as readonly string[]).includes(kind);
}

// A board as the join prompt names it: its agent steps and how many items wait for an agent.
export type JoinBoard = { name: string; agentSteps: readonly string[]; waiting: number };

// The project as an agent joining it needs to know it: `working`, the agents listening now or
// holding an item. `first`: no agent works there now, so the one joining has nobody to join.
// `repo`: the project's folder is a git repository (false for a plain folder, such as a page a
// non-developer keeps): the prompts then speak of no repository, history, CI or worktree.
export type JoinFacts = {
  boards: readonly JoinBoard[];
  working: readonly string[];
  first?: boolean;
  repo?: boolean;
};

// Every agent connects: it refreshes AGENTS.md and is told which MCP server to add to its own
// harness. Nothing it writes names it, so another agent's connect never takes anything from it.
const CONNECT = 'otea connect --as <name> --model <model> --effort <effort>';
const CONNECT_ES = 'otea connect --as <nombre> --model <modelo> --effort <esfuerzo>';
// A restart a harness needs to load the server comes first, before the interview: a new session
// would not know what was said (p3-company run 2), unless it reopens the same conversation.
// Three sentences: what connect does, the restart, and what to do until the server loads. The
// start prompt gives each its own line; the join prompt runs them together.
const WRITES =
  "writes AGENTS.md and prints the MCP server to add to your own harness's config: add it yourself if you have not";
const RESTART =
  "If your harness must restart or reload to load it, or I must approve it, ask me now, before step 2, and tell me to reopen this same conversation with your harness's resume option, if it has one, so you keep what we said; Otea keeps every item and board draft either way";
const UNTIL = 'Until it loads, the otea command does the same';
const CONNECTS = `it ${WRITES}. ${RESTART}. ${UNTIL}`;
const WRITES_ES =
  'escribe AGENTS.md e imprime el servidor MCP que tienes que agregar a la configuración de tu propio harness: agrégalo tú si no lo tienes';
const RESTART_ES =
  'Si tu harness tiene que reiniciarse o recargarse para cargarlo, o tengo que aprobarlo, pídemelo ahora, antes del paso 2, y dime que reabra esta misma conversación con la opción de reanudar de tu harness, si la tiene, para que conserves lo que hablamos; Otea guarda todos los ítems y borradores de tableros de todos modos';
const UNTIL_ES = 'Hasta que cargue, el comando otea hace lo mismo';
const CONNECTS_ES = `${WRITES_ES}. ${RESTART_ES}. ${UNTIL_ES}`;
const DRAFT =
  'otea board draft --new "<name>" --why "<what it is for, in my words>" --template <key>';
const NAME = (example: string) => `lowercase letters, digits and dashes, such as ${example}`;
const NAME_ES = (example: string) => `letras minúsculas, dígitos y guiones, como ${example}`;

// The example name a prompt gives: claude-b, or the next letter nobody works under, so an agent
// that takes it as given does not take a name in use.
function exampleName(taken: readonly string[] = []): string {
  for (let code = 98; code <= 122; code++) {
    const name = `claude-${String.fromCharCode(code)}`;
    if (!taken.includes(name)) return name;
  }
  return 'claude-new';
}
const DRAFT_ES =
  'otea board draft --new "<nombre>" --why "<para qué es, con mis palabras>" --template <clave>';
const LOOP = 'otea wait --turn agent --unclaimed';
// The desk is the person's to open (P4-R3-9): one an agent starts in its shell closes with it.
const DESK =
  'Never start the desk (otea serve) yourself: I run it in a terminal of my own or open the Otea desktop app, since one you start closes with your session. If I ask you to start it anyway, run otea serve --no-open.';
const DESK_ES =
  'Nunca abras tú el escritorio (otea serve): lo abro yo en una terminal mía o con la app de escritorio de Otea, porque el que abres tú se cierra con tu sesión. Si igual te pido que lo abras, ejecuta otea serve --no-open.';
// Topics are off until the person turns them on (P4-R3-10): the interview offers them.
const TOPICS =
  'Ask me too whether you should keep a record of the side questions I ask you off the work (Topics); if I say yes, turn it on: `otea topic on`.';
const TOPICS_ES =
  'Pregúntame también si quiero que lleves registro de las preguntas sueltas que te hago fuera del trabajo (Temas); si digo que sí, actívalo: `otea topic on`.';
const PROFILE = 'otea profile --as <name> --model <model> --effort <effort> --harness <harness>';
const PROFILE_ES =
  'otea profile --as <nombre> --model <modelo> --effort <esfuerzo> --harness <harness>';

const WORDS = {
  en: {
    start: (repo: boolean) => [
      'Set up Otea in this project and design with me how we will work. Otea is where I hand you work and review what you hand back. Go one step at a time and tell me what you did after each one.',
      `1. Set up (${repo ? 'in the repository root' : 'in this folder'}):`,
      '- Run `otea init` if the project is not set up yet (no template).',
      `- Pick a short name of your own (${NAME(exampleName())}) and connect: \`${CONNECT}\`, with unknown for any value this session does not tell you (never guess, and never open config files outside the project to find it).`,
      `- That command ${WRITES}.`,
      `- ${RESTART}. ${UNTIL}.`,
      `- Then put your name on every otea command (\`--as <name>\`; MCP tools: as). Declare it for this session too: \`${PROFILE}\`.`,
      '- Read the guide: `otea board`.',
      `- ${DESK}`,
      repo
        ? '2. Read the project before asking me anything: the README, how the code is laid out, the git history (how often it changes, in what bursts), CLAUDE.md or AGENTS.md, and its CI.'
        : '2. Read the project before asking me anything: what is in this folder, any README or notes, and CLAUDE.md or AGENTS.md.',
      '3. Understand what I need before you propose anything. Ask me, one question at a time and in plain words, only what you still need:',
      '- what work I want agents to do here, and what you do and what I do;',
      `- what "done" looks like: what I need to see to approve something (${repo ? 'a diff, screenshots, a video, test results, a document' : 'screenshots, the page or file itself, a document'});`,
      '- who reviews it, and how many review rounds are usual;',
      `- where the result lands${repo ? ' (for code: whether anything may reach the remote before I see it)' : ''}, and what must never happen without me.`,
      `- ${TOPICS}`,
      '4. Then tell me plainly which of four outcomes fits, and why; templates are a starting point, never the only option:',
      '- A stock template fits as it is: name it (`otea board draft --help` lists them, sets too).',
      '- A template fits with these changes: name it and list the changes.',
      '- This needs a board of its own: say why and what it would hold.',
      '- Otea is not a good fit for this (for example, one-off tiny tasks are faster in plain chat): say why and do not draft anything.',
      '- For the first three, wait for my answer, then design the board or boards:',
      `- Start from the closest template and adapt it: \`${DRAFT}\`.`,
      '- `otea board draft <request id>` (the id it printed) prints it as JSON. Edit it, with the evidence each review needs.',
      '- Hand it in with `otea board draft <request id> --file board.json` until it reports nothing wrong. You never publish it.',
      '5. Tell me where to review it (Studio, from the link the draft prints), that I publish it, and to try it with a first item; offer to adjust it with a new draft if something does not fit.',
      'Then keep working until I stop you:',
      '- Run `otea next`, do the step, hand it off and run `otea next` again.',
      `- When there is nothing, run \`${LOOP}\` (in the background if you can) and then \`otea next\`.`,
      '- Answer my notes with `otea reply`.',
    ],
    design: [
      'Design one more board for this project with me. You never publish it: I do, in Studio.',
      '1. Read the project and its boards first: what is in it, its history and `otea board`. Put your agent name on every otea command (`--as <name>`; MCP tools: as).',
      '2. Ask me, one question at a time, what the board is for: who does each step, what I need to see to approve (a diff, screenshots, a video, test results, a document) and how many review rounds are usual.',
      `3. Start from the closest template (\`otea board draft --help\` lists them, sets too): \`${DRAFT}\`; \`otea board draft <request id>\` (the id it printed) prints it as JSON. Adapt it and hand it in with \`otea board draft <request id> --file board.json\` until it reports nothing wrong.`,
      '4. Tell me where to review it (the Studio link the draft prints), to try it with a first item, and that you will adjust it with a new draft if something does not fit.',
    ],
    join: {
      intro:
        'Join the work on this project as one more agent, alongside the others. Do not design or change boards.',
      firstIntro:
        'Start working on this project as its agent: its boards are ready. Do not design or change boards.',
      connect: (taken: string, example: string) =>
        `1. Run \`otea whoami --harness <harness>\` (the tool you run in): it gives back the name you worked under here before. Without one, pick a name of your own (${NAME(example)})${taken}. Then connect: \`${CONNECT}\`, with unknown for any value this session does not tell you (never guess, and never open config files outside the project to find it); ${CONNECTS}. Then put your name on every command (\`--as <name>\`; MCP tools: as). Declare it for this session too: \`${PROFILE}\`.`,
      worktree:
        'Other agents work in this same checkout: do your work on your own branch in your own git worktree (`git worktree add`), never in files another agent is changing.',
      firstWorktree:
        'More agents may join this same checkout: do your work on your own branch in your own git worktree (`git worktree add`), never in files another agent is changing.',
      folder:
        'Other agents work in this same folder: never change files another agent is changing.',
      taken: (names: string) => `, not one already working here (${names})`,
      read: '2. Read the guide and the boards: `otea board`. Where agents work:',
      board: (name: string, steps: string, waiting: number) =>
        `- ${name}: ${steps}${waiting > 0 ? ` (${waiting} waiting for an agent now)` : ''}`,
      none: '- no board has agent steps yet; wait for one with the loop below.',
      loop: `3. Work the queue until I stop you: \`otea next --claim\`, do the step, hand it off and run \`otea next\` again; when there is nothing, run \`${LOOP}\` (in the background if you can) and then \`otea next\`. Never take an item another agent holds. Answer my notes with \`otea reply\`.`,
    },
  },
  es: {
    start: (repo: boolean) => [
      'Configura Otea en este proyecto y diseña conmigo cómo vamos a trabajar. Otea es donde te paso trabajo y reviso lo que me devuelves. Ve paso a paso y dime qué hiciste después de cada uno.',
      `1. Configuración (${repo ? 'en la raíz del repositorio' : 'en esta carpeta'}):`,
      '- Ejecuta `otea init` si el proyecto aún no está configurado (sin plantilla).',
      `- Elige un nombre corto propio (${NAME_ES(exampleName())}) y conéctate: \`${CONNECT_ES}\`, con unknown en lo que esta sesión no te diga (nunca adivines ni abras archivos de configuración fuera del proyecto para buscarlo).`,
      `- Ese comando ${WRITES_ES}.`,
      `- ${RESTART_ES}. ${UNTIL_ES}.`,
      `- Luego pon tu nombre en cada comando de otea (\`--as <nombre>\`; herramientas MCP: as). Decláralo también para esta sesión: \`${PROFILE_ES}\`.`,
      '- Lee la guía: `otea board`.',
      `- ${DESK_ES}`,
      repo
        ? '2. Lee el proyecto antes de preguntarme nada: el README, cómo está organizado el código, el historial de git (cada cuánto cambia y en qué rachas), CLAUDE.md o AGENTS.md, y su CI.'
        : '2. Lee el proyecto antes de preguntarme nada: qué hay en esta carpeta, el README o las notas que tenga, y CLAUDE.md o AGENTS.md.',
      '3. Entiende lo que necesito antes de proponer nada. Pregúntame, una pregunta a la vez y con palabras simples, solo lo que te falte:',
      '- qué trabajo quiero que hagan los agentes aquí, y qué haces tú y qué hago yo;',
      `- cómo se ve "terminado": qué necesito ver para aprobar algo (${repo ? 'un diff, capturas, un vídeo, resultados de pruebas, un documento' : 'capturas, la página o el archivo mismo, un documento'});`,
      '- quién lo revisa, y cuántas rondas de revisión son normales;',
      `- dónde termina el resultado${repo ? ' (en el código: si algo puede llegar al remoto antes de que yo lo vea)' : ''}, y qué no debe pasar nunca sin mí.`,
      `- ${TOPICS_ES}`,
      '4. Luego dime con claridad cuál de cuatro resultados encaja, y por qué; las plantillas son un punto de partida, nunca la única opción:',
      '- Una plantilla de serie encaja tal cual: nómbrala (`otea board draft --help` las lista, también los conjuntos).',
      '- Una plantilla encaja con estos cambios: nómbrala y lista los cambios.',
      '- Esto necesita un tablero propio: di por qué y qué contendría.',
      '- Otea no es una buena opción para esto (por ejemplo, las tareas sueltas y mínimas van más rápido en un chat normal): di por qué y no crees ningún borrador.',
      '- En los tres primeros, espera mi respuesta y luego diseña el tablero o los tableros:',
      `- Parte de la plantilla más cercana y adáptala: \`${DRAFT_ES}\`.`,
      '- `otea board draft <id del Pedido>` (el id que imprimió) lo imprime en JSON. Edítalo, con la evidencia que pide cada revisión.',
      '- Entrégalo con `otea board draft <id del Pedido> --file board.json` hasta que no marque nada mal. Nunca lo publicas tú.',
      '5. Dime dónde revisarlo (Studio, desde el enlace que imprime el borrador), que lo publico yo, y que lo pruebe con un primer ítem; ofréceme ajustarlo con un borrador nuevo si algo no encaja.',
      'Después sigue trabajando hasta que te detenga:',
      '- Ejecuta `otea next`, haz el paso, entrégalo y vuelve a ejecutar `otea next`.',
      `- Cuando no haya nada, ejecuta \`${LOOP}\` (en segundo plano si puedes) y luego \`otea next\`.`,
      '- Contesta mis notas con `otea reply`.',
    ],
    design: [
      'Diseña conmigo un tablero más para este proyecto. Nunca lo publicas tú: lo publico yo, en Studio.',
      '1. Primero lee el proyecto y sus tableros: qué hay en él, su historial y `otea board`. Pon tu nombre de agente en cada comando de otea (`--as <nombre>`; herramientas MCP: as).',
      '2. Pregúntame, una pregunta a la vez, para qué es el tablero: quién hace cada paso, qué necesito ver para aprobar (un diff, capturas, un vídeo, resultados de pruebas, un documento) y cuántas rondas de revisión son normales.',
      `3. Parte de la plantilla más cercana (\`otea board draft --help\` las lista, también los conjuntos): \`${DRAFT_ES}\`; \`otea board draft <id del Pedido>\` (el id que imprimió) lo imprime en JSON. Adáptalo y entrégalo con \`otea board draft <id del Pedido> --file board.json\` hasta que no marque nada mal.`,
      '4. Dime dónde revisarlo (el enlace a Studio que imprime el borrador), que lo pruebe con un primer ítem, y que lo ajustarás con un borrador nuevo si algo no encaja.',
    ],
    join: {
      intro:
        'Súmate al trabajo de este proyecto como un agente más, junto a los otros. No diseñes ni cambies tableros.',
      firstIntro:
        'Empieza a trabajar en este proyecto como su agente: sus tableros están listos. No diseñes ni cambies tableros.',
      connect: (taken: string, example: string) =>
        `1. Ejecuta \`otea whoami --harness <harness>\` (la herramienta en la que trabajas): te devuelve el nombre con el que ya trabajaste aquí. Si no te da ninguno, elige un nombre propio (${NAME_ES(example)})${taken}. Luego conéctate: \`${CONNECT_ES}\`, con unknown en lo que esta sesión no te diga (nunca adivines ni abras archivos de configuración fuera del proyecto para buscarlo); ${CONNECTS_ES}. Luego pon tu nombre en cada comando (\`--as <nombre>\`; herramientas MCP: as). Decláralo también para esta sesión: \`${PROFILE_ES}\`.`,
      worktree:
        'Otros agentes trabajan en esta misma copia del repositorio: haz tu trabajo en tu propia rama y en tu propio worktree de git (`git worktree add`), nunca en archivos que otro agente está cambiando.',
      firstWorktree:
        'Pueden sumarse más agentes a esta misma copia del repositorio: haz tu trabajo en tu propia rama y en tu propio worktree de git (`git worktree add`), nunca en archivos que otro agente está cambiando.',
      folder:
        'Otros agentes trabajan en esta misma carpeta: nunca cambies archivos que otro agente está cambiando.',
      taken: (names: string) => `, que no sea uno de los que ya trabajan aquí (${names})`,
      read: '2. Lee la guía y los tableros: `otea board`. Donde trabajan los agentes:',
      board: (name: string, steps: string, waiting: number) =>
        `- ${name}: ${steps}${waiting > 0 ? ` (${waiting} ${waiting === 1 ? 'espera' : 'esperan'} a un agente ahora)` : ''}`,
      none: '- ningún tablero tiene pasos de agente todavía; espera con el bucle de abajo.',
      loop: `3. Trabaja la cola hasta que te detenga: \`otea next --claim\`, haz el paso, entrégalo y vuelve a ejecutar \`otea next\`; cuando no haya nada, ejecuta \`${LOOP}\` (en segundo plano si puedes) y luego \`otea next\`. Nunca tomes un ítem que tiene otro agente. Contesta mis notas con \`otea reply\`.`,
    },
  },
} as const;

// `repo`: whether the project is a git repository (the default); a plain folder hears no git words.
export function startPrompt(lang: Lang, repo = true): string {
  return WORDS[lang].start(repo).join('\n');
}

export function designPrompt(lang: Lang): string {
  return WORDS[lang].design.join('\n');
}

export function joinPrompt(lang: Lang, facts: JoinFacts): string {
  const words = WORDS[lang].join;
  const working = [...new Set(facts.working)];
  const taken = working.length > 0 ? words.taken(working.join(', ')) : '';
  const boards = facts.boards.filter(({ agentSteps }) => agentSteps.length > 0);
  // Nobody to join: nobody works there now (or no agent was ever seen).
  const first = facts.first === true || working.length === 0;
  const repo = facts.repo !== false;
  // The first prompt is pasted into a second chat too, before the first agent shows: it asks for
  // a worktree as well, so two sessions never share one checkout.
  const apart = repo ? (first ? words.firstWorktree : words.worktree) : first ? '' : words.folder;
  return [
    [first ? words.firstIntro : words.intro, apart].filter(Boolean).join(' '),
    words.connect(taken, exampleName(working)),
    words.read,
    ...(boards.length > 0
      ? boards.map(({ name, agentSteps, waiting }) =>
          words.board(name, agentSteps.join(', '), waiting),
        )
      : [words.none]),
    words.loop,
  ].join('\n');
}

// What the person reads beside the prompt, in plain words: whether the project is a git repository
// (`code`, the same fact the prompts are written from, so the note and the pasted text never
// disagree about a worktree) and the boards the agent will work, by the names the screen's
// language gives them. The words themselves are the desk's (connect.*).
export type ConnectFacts = {
  code: boolean;
  boards: readonly { name: string; steps: readonly string[] }[];
};

export function connectFacts(facts: JoinFacts): ConnectFacts {
  const boards = facts.boards
    .filter(({ agentSteps }) => agentSteps.length > 0)
    .map(({ name, agentSteps }) => ({ name, steps: agentSteps }));
  return { code: facts.repo !== false, boards };
}

// The canonical way of working: one chat coordinates and never does an item, a worker per board
// does them, and the person decides on the desk or the phone. Otea never launches an agent: the
// coordinator launches its workers with the worker text, or the person pastes it into a chat of
// each. Two texts, in the language of the project like the moments above.
export const ROLES = ['coordinator', 'worker'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

// What a role text is filled with: the board a worker works (a coordinator names none: each worker
// it launches has its own) and the name the agent works under, when it is already chosen.
export type RoleFacts = { board?: string; name?: string };

// A board name as a command takes it: quoted when it has a space.
const quoted = (board: string) => (/\s/.test(board) ? `"${board}"` : board);

const ROLE_WORDS = {
  en: {
    coordinator: (name: string | undefined) => [
      "You are the coordinator for this project's Otea boards. Your job is to talk with me and keep the work moving; you never do an item yourself.",
      name === undefined
        ? `1. Set up: run \`otea whoami\`, reuse its name or pick one (${NAME(exampleName())}), put it on every otea call (\`--as <name>\`), and declare your profile: \`otea profile --model <id> --effort <level> --as <name>\`.`
        : `1. Set up: your name is ${name}; put \`--as ${name}\` on every otea call, and declare your profile: \`otea profile --model <id> --effort <level> --as ${name}\`.`,
      '2. When I ask for something, put it on a board: `otea create` with What I want and How I check it filled in, so it skips Clarify. Ask me one question at a time if it is unclear. A question that is not a request (advice, an explanation) is a topic: record it and answer it there.',
      '3. Keep workers running: one per board that has work, at most two on a code board. Give each its own name and launch it as a background subagent if your harness can, with the output of `otea prompt --role worker --board <board> --as <worker name>` as its instructions; otherwise tell me to open a new chat and paste that output. Relaunch a worker when the desk says nobody is listening on its board.',
      '4. After every reply to me, start `otea wait` again in the background so you hear the desk (my answers, my notes, new items). Never write a polling loop of your own.',
      '5. Never take, claim or hand off an item, never approve or send back for me, never relay my decisions.',
    ],
    worker: (board: string, name: string | undefined) => {
      const as = name ?? '<name>';
      return [
        name === undefined
          ? `You are a worker on the Otea board ${board}. First run \`otea whoami --harness <harness>\` and reuse the name it gives back, or pick one of your own (${NAME(exampleName())}); then use \`--as <name>\` on every otea call.`
          : `You are a worker on the Otea board ${board}. Your name is ${name}; use \`--as ${name}\` on every otea call.`,
        `1. Declare your profile: \`otea profile --model <id> --effort <level> --as ${as}\`.`,
        `2. Loop: \`otea next --collection ${quoted(board)} --claim --as ${as}\`; do exactly what the step says, including every line of "Before you hand it off"; hand off with the exact command next prints; then run \`otea next\` again.`,
        "3. Work in your own git worktree for the item's branch. To land approved work: merge main into the branch (`git merge origin/main`), push normally, then push it to main as the step says. Never force push, never rebase a pushed branch.",
        '4. If you need the person, ask on the item with `otea ask <id> "<question>"` and keep working on other items or wait; never stop silently.',
        `5. When \`otea next\` has nothing for you, wait with \`otea wait --turn agent --unclaimed --as ${as}\` and continue when it returns. Stop only when the person or the coordinator tells you to; release what you hold before you stop.`,
      ];
    },
  },
  es: {
    coordinator: (name: string | undefined) => [
      'Eres el coordinador de los tableros de Otea de este proyecto. Tu trabajo es hablar conmigo y mantener el trabajo en marcha; nunca haces un ítem tú mismo.',
      name === undefined
        ? `1. Configuración: ejecuta \`otea whoami\`, reutiliza su nombre o elige uno (${NAME_ES(exampleName())}), ponlo en cada llamada de otea (\`--as <nombre>\`) y declara tu perfil: \`otea profile --model <id> --effort <nivel> --as <nombre>\`.`
        : `1. Configuración: tu nombre es ${name}; pon \`--as ${name}\` en cada llamada de otea y declara tu perfil: \`otea profile --model <id> --effort <nivel> --as ${name}\`.`,
      '2. Cuando te pida algo, ponlo en un tablero: `otea create` con Qué quiero y Cómo lo valido llenados, para que se salte Aclarar. Hazme una pregunta a la vez si no está claro. Una pregunta que no es un pedido (un consejo, una explicación) es un tema: regístralo y respóndelo ahí.',
      '3. Mantén trabajadores en marcha: uno por tablero que tenga trabajo, como máximo dos en un tablero de código. Dale a cada uno su propio nombre y lánzalo como subagente en segundo plano si tu harness puede, con lo que imprime `otea prompt --role worker --board <tablero> --as <nombre del worker>` como instrucciones; si no, dime que abra un chat nuevo y pegue eso. Vuelve a lanzar un worker cuando el escritorio diga que nadie escucha en su tablero.',
      '4. Después de cada respuesta a mí, vuelve a iniciar `otea wait` en segundo plano para oír el escritorio (mis respuestas, mis notas, ítems nuevos). Nunca escribas un bucle de sondeo propio.',
      '5. Nunca tomes, reclames ni entregues un ítem, nunca apruebes ni devuelvas con una nota por mí, nunca retransmitas mis decisiones.',
    ],
    worker: (board: string, name: string | undefined) => {
      const as = name ?? '<nombre>';
      return [
        name === undefined
          ? `Eres un worker del tablero ${board} de Otea. Primero ejecuta \`otea whoami --harness <harness>\` y reutiliza el nombre que te devuelve, o elige uno propio (${NAME_ES(exampleName())}); luego usa \`--as <nombre>\` en cada llamada de otea.`
          : `Eres un worker del tablero ${board} de Otea. Tu nombre es ${name}; usa \`--as ${name}\` en cada llamada de otea.`,
        `1. Declara tu perfil: \`otea profile --model <id> --effort <nivel> --as ${as}\`.`,
        `2. Bucle: \`otea next --collection ${quoted(board)} --claim --as ${as}\`; haz exactamente lo que dice el paso, incluida cada línea de "Before you hand it off" (así la imprime otea next); entrega con el comando exacto que imprime next; luego vuelve a ejecutar \`otea next\`.`,
        '3. Trabaja en tu propio worktree de git para la rama del ítem. Para integrar el trabajo aprobado: mezcla main en la rama (`git merge origin/main`), publícala normalmente y luego súbela a main como dice el paso. Nunca hagas force push, nunca rebases una rama ya publicada.',
        '4. Si necesitas a la persona, pregunta en el ítem con `otea ask <id> "<pregunta>"` y sigue con otros ítems o espera; nunca te detengas en silencio.',
        `5. Cuando \`otea next\` no tenga nada para ti, espera con \`otea wait --turn agent --unclaimed --as ${as}\` y sigue cuando vuelva. Detente solo cuando la persona o el coordinador te lo diga; suelta lo que tengas antes de detenerte.`,
      ];
    },
  },
} as const;

// The text of a role. A worker's board is required (the CLI and the server ask for it); the one
// without a name tells the agent to pick it with whoami, and the commands carry a placeholder.
export function rolePrompt(role: Role, lang: Lang, facts: RoleFacts): string {
  const words = ROLE_WORDS[lang];
  if (role === 'coordinator') return words.coordinator(facts.name).join('\n');
  return words.worker(facts.board ?? '<board>', facts.name).join('\n');
}

// The prompt for a moment, `join` built from the project's facts.
export function agentPrompt(kind: PromptKind, lang: Lang, facts: JoinFacts): string {
  if (kind === 'start') return startPrompt(lang, facts.repo !== false);
  if (kind === 'design') return designPrompt(lang);
  return joinPrompt(lang, facts);
}

import { describe, expect, it } from 'vitest';
import {
  agentPrompt,
  designPrompt,
  isRole,
  joinPrompt,
  ROLES,
  rolePrompt,
  startPrompt,
} from './agent-prompts.ts';

describe('the start prompt', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`walks a new project through set up, reading, interview, draft and trying it (${lang})`, () => {
      const text = startPrompt(lang);
      for (const command of [
        'otea init',
        'otea connect --as',
        'unknown',
        'otea board',
        'otea board draft --new',
        '--why',
        '--template',
        'otea board draft',
        '--file board.json',
        'otea profile --as',
        'otea next',
        'otea wait --turn agent --unclaimed',
        'otea reply',
      ])
        expect(text).toContain(command);
      expect(text).toMatch(lang === 'es' ? /una pregunta a la vez/ : /one question at a time/);
      expect(text).toMatch(
        lang === 'es'
          ? /letras minúsculas, dígitos y guiones, como claude-b/
          : /lowercase letters, digits and dashes, such as claude-b/,
      );
      // The board a draft hands in on is named in the screen's words, not the Spanish built-in's.
      expect(text).toContain(lang === 'es' ? '<id del Pedido>' : '<request id>');
      expect(text).not.toContain(lang === 'es' ? '<Pedido>' : 'Pedido');
      expect(text).toMatch(lang === 'es' ? /lo publico yo/ : /I publish it/);
      // A command run without the name fails (exit 2): the prompt says to put it on each one.
      expect(text).toContain(
        lang === 'es'
          ? 'pon tu nombre en cada comando de otea (`--as <nombre>`'
          : 'put your name on every otea command (`--as <name>`',
      );
    });
  }

  // A plain folder (a page kept by someone who never uses git): no repo, git, CI or diff words.
  it('speaks of no repository, git, CI or diff in a folder that is no git repository', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = startPrompt(lang, false);
      expect(text).not.toMatch(/repositor|\bgit\b|\bCI\b|\bdiff\b/i);
      expect(text).toContain(lang === 'es' ? 'en esta carpeta' : 'in this folder');
      expect(text).toContain('otea connect --as');
    }
    expect(agentPrompt('start', 'en', { boards: [], working: [], repo: false })).toBe(
      startPrompt('en', false),
    );
  });

  // P9-F1: the first contact was five paragraphs, the first of them 250 words. Each step is a line
  // that names it, with a short line for each thing to do; the pasted text stays a list of lines
  // (the desk shows one paragraph a line).
  for (const lang of ['en', 'es'] as const) {
    it(`is a list of short lines under five steps, not walls of text (${lang})`, () => {
      for (const repo of [true, false]) {
        const lines = startPrompt(lang, repo).split('\n');
        const words = (line: string) => line.split(/\s+/).length;

        expect(lines.filter((line) => /^[1-5]\. /.test(line))).toHaveLength(5);
        expect(Math.max(...lines.map(words))).toBeLessThanOrEqual(70);
        expect(lines.filter((line) => line.startsWith('- ')).length).toBeGreaterThan(15);
        expect(new Set(lines).size).toBe(lines.length);
        expect(lines.some((line) => line.trim() === '')).toBe(false);
      }
    });
  }

  it('tells the agent connect prints the MCP server it adds to its own harness', () => {
    expect(startPrompt('en')).toContain(
      "prints the MCP server to add to your own harness's config: add it yourself",
    );
    expect(startPrompt('es')).toContain('agrégalo tú');
  });

  // p3-company run 2: the person restarted the agent after the interview so MCP would load, and
  // the new session had lost what the interview said. A restart comes first, before the interview,
  // and reopens the same conversation where the harness can.
  it('asks for any restart the MCP server needs before the interview, reopening the same conversation', () => {
    for (const prompt of [startPrompt('en'), joinPrompt('en', { boards: [], working: [] })])
      expect(prompt).toContain(
        "If your harness must restart or reload to load it, or I must approve it, ask me now, before step 2, and tell me to reopen this same conversation with your harness's resume option, if it has one, so you keep what we said; Otea keeps every item and board draft either way.",
      );
    expect(startPrompt('es')).toContain(
      'Si tu harness tiene que reiniciarse o recargarse para cargarlo, o tengo que aprobarlo, pídemelo ahora, antes del paso 2, y dime que reabra esta misma conversación con la opción de reanudar de tu harness, si la tiene, para que conserves lo que hablamos; Otea guarda todos los ítems y borradores de tableros de todos modos.',
    );
  });

  // P4-R3-9: the agent ran otea serve in its own shell, so the desk died with its session.
  it('leaves the desk to the person, and says --no-open if the agent must start it', () => {
    expect(startPrompt('en')).toContain(
      'Never start the desk (otea serve) yourself: I run it in a terminal of my own or open the Otea desktop app, since one you start closes with your session. If I ask you to start it anyway, run otea serve --no-open.',
    );
    expect(startPrompt('es')).toContain(
      'Nunca abras tú el escritorio (otea serve): lo abro yo en una terminal mía o con la app de escritorio de Otea, porque el que abres tú se cierra con tu sesión. Si igual te pido que lo abras, ejecuta otea serve --no-open.',
    );
  });

  // 0.8: side questions are consultations the secretary saves, so the interview no longer offers
  // Temas (and `otea topic on`).
  it('does not offer to keep a record of the side questions', () => {
    for (const lang of ['en', 'es'] as const)
      expect(startPrompt(lang)).not.toMatch(/otea topic|\bTopics\b|\bTemas\b/);
  });
});

describe('the design prompt', () => {
  it('drafts one more board from a template and never publishes it', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = designPrompt(lang);
      expect(text).toContain('otea board draft --new');
      expect(text).toContain('--template');
      expect(text).not.toContain('otea connect');
      expect(text).toContain(lang === 'es' ? '`--as <nombre>`' : '`--as <name>`');
    }
  });
});

describe('the join prompt', () => {
  const facts = {
    boards: [
      { name: 'Cambios', agentSteps: ['Aclarar', 'Hacerlo', 'Integrar'], waiting: 2 },
      { name: 'Errores', agentSteps: ['Completar', 'Arreglar'], waiting: 0 },
      { name: 'Revisiones', agentSteps: [], waiting: 0 },
    ],
    working: ['claude', 'codex', 'claude'],
  };

  it('names the agents already working, the agent steps and what waits now', () => {
    const text = joinPrompt('es', facts);
    expect(text).toContain('que no sea uno de los que ya trabajan aquí (claude, codex)');
    expect(text).toContain('- Cambios: Aclarar, Hacerlo, Integrar (2 esperan a un agente ahora)');
    expect(text).toContain('- Errores: Completar, Arreglar');
    expect(text).not.toContain('Errores: Completar, Arreglar (');
    expect(text).not.toContain('Revisiones');
    expect(text).toContain('otea next --claim');
    expect(text).toContain('Nunca tomes un ítem que tiene otro agente');
    expect(text).not.toContain('otea board draft');
    // Every agent connects: what connect writes names nobody, so it takes nothing from another.
    expect(text).toContain('otea connect --as <nombre>');
    expect(text).toContain('servidor MCP');
    expect(text).toContain(
      'otea profile --as <nombre> --model <modelo> --effort <esfuerzo> --harness <harness>',
    );
    expect(text).toContain('letras minúsculas, dígitos y guiones, como claude-b');
    // Two agents in one checkout would edit the same files.
    expect(text).toContain('git worktree add');
  });

  it('lets the first agent of a project with boards connect, with nobody to join', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = joinPrompt(lang, { ...facts, working: [], first: true });
      expect(text).toContain(
        lang === 'es' ? 'otea connect --as <nombre>' : 'otea connect --as <name>',
      );
      expect(text).not.toMatch(/No ejecutes otea connect|Do not run otea connect/);
      expect(text).not.toMatch(/junto a los otros|alongside the others/);
      expect(text).toContain('otea profile --as');
      // Pasted into a second chat too, it must not leave two agents in one checkout.
      expect(text).toContain('git worktree add');
    }
  });

  // Agents seen before, none working now: nobody to join, as for the very first one.
  it('joins nobody when no agent works there now', () => {
    const text = joinPrompt('es', { boards: facts.boards, working: [] });
    expect(text).toMatch(/^Empieza a trabajar en este proyecto como su agente/);
    expect(text).not.toContain('junto a los otros');
  });

  it('asks for no worktree in a folder that is no git repository', () => {
    const text = joinPrompt('en', { ...facts, repo: false });
    expect(text).not.toMatch(/worktree|checkout|\bgit\b/);
    expect(text).toContain('never change files another agent is changing');
  });

  it('gives as example a name nobody works under', () => {
    const text = joinPrompt('en', { boards: [], working: ['claude-b', 'claude-c'] });
    expect(text).toContain('such as claude-d)');
    expect(text).not.toContain('such as claude-b');
    expect(joinPrompt('es', { boards: [], working: ['claude-b'] })).toContain('como claude-c)');
  });

  it('reads well with nobody listening and no agent steps, in English too', () => {
    const text = joinPrompt('en', { boards: [], working: [] });
    expect(text).toContain(
      'Without one, pick a name of your own (lowercase letters, digits and dashes, such as claude-b). Then connect: `otea connect --as <name>',
    );
    expect(text).toContain('no board has agent steps yet');
    expect(joinPrompt('en', facts)).toContain('(2 waiting for an agent now)');
  });

  it('is what agentPrompt gives for each moment', () => {
    expect(agentPrompt('start', 'en', facts)).toBe(startPrompt('en'));
    expect(agentPrompt('design', 'es', facts)).toBe(designPrompt('es'));
    expect(agentPrompt('join', 'es', facts)).toBe(joinPrompt('es', facts));
  });
});

// P3C-R3-8: «read from your settings» sent an agent to open the person's harness config to learn
// its effort. The prompts say to declare what the session tells it, and never to open config files.
describe('declaring the profile in the prompts', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`asks for what the session says, never a config file outside the project (${lang})`, () => {
      const join = joinPrompt(lang, { boards: [], working: [] });
      for (const text of [startPrompt(lang), join]) {
        expect(text).toContain(
          lang === 'es'
            ? 'con unknown en lo que esta sesión no te diga (nunca adivines ni abras archivos de configuración fuera del proyecto para buscarlo)'
            : 'with unknown for any value this session does not tell you (never guess, and never open config files outside the project to find it)',
        );
        expect(text).not.toMatch(lang === 'es' ? /leer de tu configuración/ : /your settings/);
      }
    });
  }
});

// The interview names what the person needs, one question at a time, and ends in one of four
// plain outcomes: a stock template as is, a template with changes, a board of its own, or no fit.
describe('the start prompt interview', () => {
  const OUTCOMES = {
    en: ['fits as it is', 'fits with these changes', 'board of its own', 'not a good fit'],
    es: ['encaja tal cual', 'encaja con estos cambios', 'tablero propio', 'no es una buena opción'],
  } as const;

  for (const lang of ['en', 'es'] as const) {
    it(`ends in one of four outcomes, said plainly, and drafts only for the first three (${lang})`, () => {
      for (const repo of [true, false]) {
        const text = startPrompt(lang, repo);
        for (const outcome of OUTCOMES[lang]) expect(text).toContain(outcome);
        // Only the board outcomes draft: the fourth stops there.
        const lines = text.split('\n');
        const stop = lines.findIndex((line) => line.includes(OUTCOMES[lang][3]));
        const draft = lines.findIndex((line) => line.includes('otea board draft --new'));
        expect(stop).toBeGreaterThan(-1);
        expect(draft).toBeGreaterThan(stop);
        expect(lines[stop]).toMatch(lang === 'es' ? /no (hagas|crees)/i : /do not draft/i);
      }
    });
  }
});

describe('the role prompts', () => {
  it('knows its three roles, and no coordinator any more', () => {
    expect(ROLES).toEqual(['secretary', 'worker', 'refiner']);
    expect(isRole('worker')).toBe(true);
    expect(isRole('coordinator')).toBe(false);
    expect(isRole('boss')).toBe(false);
  });

  for (const lang of ['en', 'es'] as const) {
    it(`gives the worker its board and name and the rules it works by (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Cambios', name: 'ana-cambios' });
      expect(text).toContain('otea next --collection Cambios --claim --as ana-cambios');
      expect(text).toContain(
        `otea profile --model <id> --effort <${lang === 'es' ? 'nivel' : 'level'}> --harness <harness> --as ana-cambios`,
      );
      expect(text).toContain('otea ask <id>');
      expect(text).toContain('otea release <id> --as ana-cambios');
      expect(text).toContain('otea wait --turn agent --unclaimed --as ana-cambios');
      // It lands with a merge of main, never a force push.
      expect(text).toContain('git merge origin/main');
      expect(text).toMatch(lang === 'es' ? /Nunca hagas force push/ : /Never force push/);
      expect(text).not.toContain('<name>');
    });

    it(`asks a worker given no name to pick one with whoami, and quotes a board with spaces (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Bug reports' });
      expect(text).toContain('otea whoami');
      expect(text).toContain('--collection "Bug reports" --claim --as <');
      expect(text).not.toContain('ana-cambios');
    });

    it(`has the secretary declare itself, listen, read and answer with --reply-to (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      expect(text).toMatch(
        lang === 'es' ? /Nunca tomas ni haces un ítem/i : /never take or do an item/i,
      );
      expect(text).toMatch(lang === 'es' ? /Nunca tomes, reclames/ : /Never take, claim/);
      expect(text).toMatch(
        lang === 'es' ? /nunca apruebes ni devuelvas/i : /never approve or send back/i,
      );
      expect(text).toContain('otea whoami');
      expect(text).toContain('otea profile --role secretary --model');
      // Its wait is the secretary's own (a bare `otea wait` fails), run again after every action.
      expect(text).toContain('`otea wait --secretary --as <');
      expect(text).not.toContain('otea wait --turn');
      expect(text).toMatch(lang === 'es' ? /después de cada acción/ : /after every action/);
      expect(text).toMatch(lang === 'es' ? /bucle de sondeo propio/ : /polling loop of your own/);
      expect(text).toContain('otea conversation --as <');
      expect(text).toContain('otea say "<');
      expect(text).toContain('--reply-to <');
    });

    // T1a: a session that died after reading a message and before answering it leaves it unanswered:
    // the next session reads the conversation before it waits.
    it(`has a new session read the conversation before it waits (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      const listen = text.slice(text.search(/\n2\. /), text.search(/\n3\. /));
      expect(listen).toContain('otea conversation --as <');
    });

    // Field study 3: a secretary told to always reply to a message put its news under old messages
    // and changed the kind of the person's turns. News is a message of its own.
    it(`says its own news as a message with no --reply-to, and acts at once on a kind the person changed (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      expect(text).not.toMatch(lang === 'es' ? /da siempre --reply-to/ : /always give --reply-to/);
      expect(text).toContain('otea say "<');
      expect(text).toMatch(
        lang === 'es'
          ? /sin --reply-to: `otea say "<texto>" --links/
          : /no --reply-to: `otea say "<text>" --links/,
      );
      expect(text).toMatch(
        lang === 'es'
          ? /nunca uses --reply-to, --request ni --links sobre un mensaje mío antiguo/
          : /never use --reply-to, --request or --links on an old message of mine/,
      );
      expect(text).toContain('kind_changed');
      expect(text).toMatch(
        lang === 'es'
          ? /nunca me preguntes de nuevo lo que ya decidí/
          : /never ask me again what I decided/,
      );
    });

    it(`sorts each message into a request with items from it or a consultation (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      expect(text).toContain('otea create --collection');
      expect(text).toContain('--from-message <');
      expect(text).toContain('--request --links <');
      expect(text).toContain('--consultation');
      expect(text).toContain(lang === 'es' ? '"Qué quiero=' : '"What I want=');
      expect(text).toContain(lang === 'es' ? '"Cómo lo valido=' : '"How I check it=');
    });

    it(`keeps a worker per board and a refiner for the Bandeja, launched with their texts (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      const board = lang === 'es' ? 'tablero' : 'board';
      expect(text).toContain(`otea prompt --role worker --board <${board}> --as <`);
      expect(text).toContain('otea prompt --role refiner --as <');
      expect(text).toMatch(lang === 'es' ? /subagente en segundo plano/ : /background subagent/);
    });

    // Field study 3 (S4 P1, S5 P3): rules 5 and 8 left a note reserved for a refiner session that
    // did not exist, and a refiner subagent was launched per note and per answer.
    it(`keeps one refiner for the whole Bandeja and never takes a note for one that is not running (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      // No instruction anywhere to take a note for a refiner.
      expect(text).not.toContain('bandeja take <B-n> --for');
      const rule = text.split('\n').find((line) => /^11\. /.test(line)) ?? '';
      expect(rule).toContain('otea bandeja take --next --wait');
      expect(rule).toContain('otea bandeja take <B-n> --as ana');
      expect(rule).toContain('otea bandeja close <B-n> --reason');
      expect(rule).toMatch(
        lang === 'es' ? /un refinador para toda la Bandeja/ : /one refiner for the whole Inbox/,
      );
      expect(rule).toMatch(lang === 'es' ? /por nota ni por respuesta/ : /per note or per answer/);
      expect(rule).toMatch(lang === 'es' ? /la nota es tuya/ : /the note is yours/);
    });

    // Field study 3 (S2 P3): an answer gave an item's state from memory, five minutes stale.
    it(`has the secretary read an item's state right before it states it, in any answer (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      const rule = text.split('\n').find((line) => /^6\. /.test(line)) ?? '';
      expect(rule).toContain('otea show <id>');
      expect(rule).toContain('otea pending --as ana');
      expect(rule).toMatch(lang === 'es' ? /en cualquier respuesta/ : /in any answer/);
    });

    // M4: the first line is the conclusion, then at most 3 short lines; the rest is a file.
    it(`answers short: a conclusion, at most 3 short lines, the rest in a file, questions with options (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      expect(text).toMatch(
        lang === 'es'
          ? /la primera línea es la conclusión, en una frase; luego, como máximo 3 líneas cortas/
          : /the first line is the conclusion, in one sentence; then at most 3 short lines/,
      );
      expect(text).toContain('`--file <');
      expect(text).toMatch(
        lang === 'es'
          ? /pregunta para mí siempre trae de 2 a 4 opciones y dice cuál recomiendas/
          : /question to me always has 2 to 4 options and says which one you recommend/,
      );
      // It asks with buttons, never as a list typed in the words.
      expect(text).toContain('--option "<a>" --option "<b>" --recommend <n>');
    });

    // M7: a harness with no background subagents does not do their work in the person's chat.
    it(`tells the person how many sessions to open and gives each one's text when it has no subagents (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      const fallback = text.split('\n').find((line) => /^8\. /.test(line)) ?? '';
      expect(fallback).toMatch(
        lang === 'es'
          ? /no puede lanzar subagentes en segundo plano/
          : /cannot launch background subagents/,
      );
      expect(fallback).toMatch(
        lang === 'es'
          ? /exactamente cuántas sesiones más abrir/
          : /exactly how many other sessions/,
      );
      expect(fallback).toMatch(lang === 'es' ? /un solo mensaje numerado/ : /one numbered message/);
      expect(fallback).toContain('otea prompt --role worker --board <');
      expect(fallback).toContain('otea prompt --role refiner');
      // Each text goes in a fenced block under its number: the desk draws it with a Copy button.
      expect(fallback).toMatch(lang === 'es' ? /bloque de código \(```\)/ : /fenced block \(```\)/);
      expect(fallback).toMatch(
        lang === 'es'
          ? /la línea de arriba dice para qué es/
          : /the line above says what it is for/,
      );
    });

    // Field study 3: «lo tomó a las 06:19 UTC» (it was 07:19), «main está en su commit f4109ea»,
    // «Done»: words of the tool in what the person reads.
    it(`has the secretary speak in the person's time and in their words (${lang})`, () => {
      const text = rolePrompt('secretary', lang, {});
      const words = text.split('\n').find((line) => /^7\. /.test(line)) ?? '';
      expect(words).toMatch(
        lang === 'es' ? /hora de la persona, nunca en UTC/ : /my local time, never UTC/,
      );
      expect(words).toMatch(lang === 'es' ? /ni ids de commit/ : /no commit ids/);
    });

    it(`has the refiner turn a Bandeja note into an item, asking on the entry with options (${lang})`, () => {
      const text = rolePrompt('refiner', lang, { name: 'ana-ref' });
      expect(text).toContain('otea bandeja --as ana-ref');
      // One refiner for the whole Bandeja: it takes the notes in turn, waiting for the next, and
      // goes on after it asks the person (field study 3, S5 P3).
      expect(text).toContain('otea bandeja take --next --wait --timeout 90s --as ana-ref');
      expect(text).toMatch(
        lang === 'es'
          ? /nunca te detengas porque la Bandeja esté vacía/
          : /never stop because the Inbox is empty/,
      );
      expect(text).toContain('otea bandeja close <B-n> --reason');
      expect(text).toContain('--from-bandeja <B-n> --as ana-ref');
      expect(text).toContain(lang === 'es' ? '"Qué quiero=' : '"What I want=');
      expect(text).toContain(lang === 'es' ? '"Cómo lo valido=' : '"How I check it=');
      expect(text).toContain('otea ask <B-n> "<');
      expect(text).toContain('--option "<');
      expect(text).toContain('--recommend <n>');
      expect(text).toMatch(
        lang === 'es' ? /nunca hagas un ítem tú mismo/ : /never do an item yourself/,
      );
      expect(text).not.toContain('<name>');
    });

    it(`asks a refiner given no name to pick one with whoami (${lang})`, () => {
      const text = rolePrompt('refiner', lang, {});
      expect(text).toContain('otea whoami');
      expect(text).toContain(lang === 'es' ? '--as <nombre>' : '--as <name>');
    });

    // The worker asks the person with options too (the guide's rule 10).
    it(`has the worker ask with options and stop only for the person or the secretary (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Cambios', name: 'ana' });
      expect(text).toContain('--option "<');
      expect(text).toContain('--recommend <n>');
      expect(text).toMatch(
        lang === 'es' ? /o el secretario te lo diga/ : /or the secretary tells you to/,
      );
      expect(text).not.toMatch(/coordinador|coordinator/i);
    });

    // Field study 3: workers worked in the person's main checkout, left worktrees and evidence
    // files beside the repo, wrote to the temp folder, and Git Bash turned /d/... into D:\d\...
    it(`fixes where a worker works and keeps its files, with the Windows Git Bash rule (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Cambios', name: 'ana' });
      expect(text).toContain('git worktree add .otea/worktrees/<');
      expect(text).toContain('.otea/tmp/<');
      expect(text).toContain('MSYS_NO_PATHCONV=1');
      // After landing, the person's main checkout follows only when that is safe.
      expect(text).toContain('otea land sync <');
      expect(text).toContain('--as ana');
      expect(text).not.toContain('merge --ff-only');
      const folder = lang === 'es' ? 'carpeta' : 'folder';
      expect(text).toContain(`D:/${folder}`);
      expect(text).toContain(`/d/${folder}`);
    });

    // Cold review G2: a board with no repository or protected branch (a notes or to-do board) was
    // told to make a git worktree and run `land sync` that have no meaning there.
    it(`gives a board with no code no worktree, merge or land sync, only where its files go (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Notas', name: 'ana', code: false });
      expect(text).not.toMatch(/worktree|land sync|git merge|force push/);
      expect(text).toContain('.otea/tmp/');
      expect(text).toContain('MSYS_NO_PATHCONV=1');
      // What the person reads goes in their own folder, and Otea checks it is there (U3).
      expect(text).toContain(
        lang === 'es' ? 'Otea rechaza la entrega' : 'Otea refuses the handoff',
      );
      // The rules keep their numbers: the others are the ones the code board has.
      const numbered = (code: boolean) =>
        rolePrompt('worker', lang, { board: 'Notas', name: 'ana', code })
          .split('\n')
          .filter((line) => /^\d\. /.test(line))
          .map((line) => line.slice(0, 2));
      expect(numbered(false)).toEqual(numbered(true));
      const withCode = rolePrompt('worker', lang, { board: 'Notas', name: 'ana', code: true });
      expect(withCode).toContain('git worktree add');
      expect(withCode).toContain('otea land sync <');
    });

    // A decision is the person's, one at a time: a permission that lives only in an agent's memory
    // is invisible and cannot be revoked, so no role offers one or takes one.
    it(`has every role refuse a standing permission and ask each time (${lang})`, () => {
      const roles = [
        rolePrompt('worker', lang, { board: 'Cambios', name: 'ana' }),
        rolePrompt('refiner', lang, { name: 'ana-ref' }),
        rolePrompt('secretary', lang, { name: 'ana' }),
      ];
      for (const text of roles) {
        const rule =
          text
            .split('\n')
            .find((line) =>
              (lang === 'es' ? /permiso permanente/ : /standing permission/).test(line),
            ) ?? '';
        expect(rule).toMatch(lang === 'es' ? /desde ahora/ : /from now on/);
        expect(rule).toMatch(lang === 'es' ? /pregunta cada vez/ : /ask each time/);
        expect(rule).toMatch(lang === 'es' ? /todavía no/ : /not supported yet/);
      }
    });

    // Field study 3 (S1 P2): a remote added after init reached the person as a technical question.
    it(`has the worker put the remote-added question to the person in plain words, with options (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Cambios', name: 'ana' });
      const rule = text.split('\n').find((line) => /^7\. /.test(line)) ?? '';
      expect(rule).toContain('otea ask');
      expect(rule).toContain('--option');
      expect(rule).toMatch(
        lang === 'es' ? /nunca le pegues el comando/ : /never paste the command/,
      );
    });

    it(`keeps a refiner's files inside the project and reads attachments where Otea prints them (${lang})`, () => {
      const text = rolePrompt('refiner', lang, { name: 'ana-ref' });
      expect(text).toContain('.otea/tmp/');
      expect(text).toContain('MSYS_NO_PATHCONV=1');
    });

    // Field study 4 (U6): «summarize what was done» was wrong twice, and an opencode secretary gave
    // the session texts as .md downloads.
    it(`has the secretary answer a summary from otea pending and give session texts as blocks, never files (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      expect(text).toContain(
        lang === 'es' ? 'Hecho en las últimas 24 horas' : 'Done in the last 24 hours',
      );
      expect(text).toContain(
        lang === 'es' ? 'nunca como archivo ni descarga' : 'never as a file or a download',
      );
    });

    // Field study 3 (F4): «what waits for me today» left a review out because the secretary told it
    // from memory, and its «ready to review» notices came late or never.
    it(`has the secretary read what waits for the person from otea pending, never from memory (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      const rule = text.split('\n').find((line) => /^9\. /.test(line)) ?? '';
      expect(rule).toContain('otea pending --as ana');
      expect(rule).toMatch(
        lang === 'es' ? /¿Qué me espera hoy\?/ : /what is waiting for me today/i,
      );
      expect(rule).toMatch(lang === 'es' ? /nunca de memoria/ : /never from memory/);
      // It tells me what became mine: a notice, with the items, counted from pending.
      expect(rule).toMatch(lang === 'es' ? /revisión/ : /review/);
      expect(rule).toMatch(lang === 'es' ? /ocupa toda la cola/ : /holds the whole queue/);
    });

    it(`has the secretary tell me an escalation in Hablar at once (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      const rule = text.split('\n').find((line) => /^10\. /.test(line)) ?? '';
      expect(rule).toContain('`escalation`');
      expect(rule).toContain(lang === 'es' ? 'Hablar' : 'Talk');
      expect(rule).toContain('otea say "<');
      expect(rule).toContain('--links');
      // A question the person already sees (it is in otea pending) is pointed to, never asked again:
      // it would count twice.
      expect(rule).toContain('`otea pending`');
      expect(rule).toMatch(
        lang === 'es' ? /no la repitas con opciones/ : /do not ask it again with options/,
      );
    });

    // Field study 4 (H1): the secretary's behaviours that only its text can give. The commands in
    // them are checked against the CLI by cli/prompt.test.ts.
    it(`has the secretary hear a review, launch a second worker, change an item under a worker and ask a send-back with one tap, and never sound done (${lang})`, () => {
      const text = rolePrompt('secretary', lang, { name: 'ana' });
      const rule = (n: number) =>
        text.split('\n').find((line) => new RegExp(`^${n}\\. `).test(line)) ?? '';
      // A delivery that reaches my review wakes the wait, and I am told in one line.
      expect(rule(2)).toContain('`ready_for_review`');
      expect(rule(9)).toContain('`ready_for_review`');
      expect(rule(9)).toMatch(lang === 'es' ? /una línea/ : /one line/);
      // A second worker on its own, from what otea pending says.
      expect(rule(5)).toMatch(/otea pending/);
      expect(rule(5)).toMatch(
        lang === 'es'
          ? /lanza tú el segundo, sin preguntarme/
          : /launch the second one yourself, without asking me/,
      );
      // A reply to a new request never sounds done before the item is.
      expect(rule(4)).toMatch(lang === 'es' ? /en cola como CAM-3/ : /queued as CAM-3/);
      expect(rule(4)).toMatch(
        lang === 'es' ? /antes que cualquier pedido nuevo/ : /before any new request/,
      );
      // A change of mind: update and tell the worker; in my review, a one-tap card, never the secretary.
      expect(rule(12)).toContain('otea update <id>');
      expect(rule(12)).toContain('--tell');
      expect(rule(12)).toContain('--send-back <id> --note');
      expect(rule(12)).toMatch(
        lang === 'es' ? /tú nunca lo devuelves/ : /you never send it back yourself/,
      );
    });

    // Field study 4 (U1): the first refiner ended its turn while its 9-minute wait ran in the
    // background, and the note waited for the secretary. Its wait stays within a harness's foreground.
    it(`keeps the refiner's wait short, and never lets it end its turn while it waits (${lang})`, () => {
      const text = rolePrompt('refiner', lang, { name: 'ana-ref' });
      const wait = /otea bandeja take --next --wait --timeout (\d+)s/.exec(text);
      expect(wait).not.toBeNull();
      expect(Number(wait?.[1])).toBeLessThanOrEqual(110);
      expect(text).toMatch(
        lang === 'es'
          ? /Nunca termines tu turno mientras esperas/
          : /Never end your turn while you wait/,
      );
    });

    it(`has a worker and a refiner escalate to the secretary what I must know (${lang})`, () => {
      for (const text of [
        rolePrompt('worker', lang, { board: 'Cambios', name: 'ana' }),
        rolePrompt('refiner', lang, { name: 'ana-ref' }),
      ]) {
        expect(text).toContain('otea escalate <');
        expect(text).toMatch(lang === 'es' ? /el secretario/ : /the secretary/);
        // Never only in its own terminal.
        expect(text).toContain('terminal');
      }
    });
  }

  it('gives a secretary its name when told, and is written in the language asked', () => {
    const named = rolePrompt('secretary', 'en', { name: 'ana' });
    expect(named).toContain('your name is ana');
    expect(named).not.toContain('otea whoami');
    expect(rolePrompt('secretary', 'es', {})).not.toBe(rolePrompt('secretary', 'en', {}));
    expect(rolePrompt('worker', 'es', { board: 'Cambios' })).toContain('Eres un trabajador');
    expect(rolePrompt('refiner', 'es', {})).toContain('Eres el refinador');
  });

  // The Spanish texts say "trabajador" and "refinador"; `--role worker|refiner` stays the
  // command's value.
  it('says trabajador and refinador in Spanish, keeping only the --role value in English', () => {
    for (const role of ROLES) {
      const text = rolePrompt(role, 'es', { board: 'Cambios', name: 'ana' });
      expect(text.replace(/--role (worker|refiner)/g, '')).not.toMatch(/\b(workers?|refiners?)\b/i);
    }
    const secretary = rolePrompt('secretary', 'es', {});
    expect(secretary).toContain('--role worker');
    expect(secretary).toContain('--role refiner');
  });
});

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

  // P4-R3-10: Temas is off by default, and the interview never offered it.
  it('asks in the interview whether to keep the side questions, and how to turn that on', () => {
    expect(startPrompt('en')).toContain(
      'Ask me too whether you should keep a record of the side questions I ask you off the work (Topics); if I say yes, turn it on: `otea topic on`.',
    );
    expect(startPrompt('es')).toContain(
      'Pregúntame también si quiero que lleves registro de las preguntas sueltas que te hago fuera del trabajo (Temas); si digo que sí, actívalo: `otea topic on`.',
    );
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
  it('knows its two roles', () => {
    expect(ROLES).toEqual(['coordinator', 'worker']);
    expect(isRole('worker')).toBe(true);
    expect(isRole('boss')).toBe(false);
  });

  for (const lang of ['en', 'es'] as const) {
    it(`gives the worker its board and name and the rules it works by (${lang})`, () => {
      const text = rolePrompt('worker', lang, { board: 'Cambios', name: 'ana-cambios' });
      expect(text).toContain('otea next --collection Cambios --claim --as ana-cambios');
      expect(text).toContain(
        `otea profile --model <id> --effort <${lang === 'es' ? 'nivel' : 'level'}> --as ana-cambios`,
      );
      expect(text).toContain('otea ask <id>');
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

    it(`keeps the coordinator from ever taking an item, and has it keep listening (${lang})`, () => {
      const text = rolePrompt('coordinator', lang, {});
      expect(text).toMatch(lang === 'es' ? /nunca haces un ítem/i : /never do an item yourself/i);
      expect(text).toMatch(lang === 'es' ? /Nunca tomes, reclames/ : /Never take, claim/);
      expect(text).toMatch(
        lang === 'es' ? /nunca apruebes ni devuelvas/i : /never approve or send back/i,
      );
      expect(text).toContain('otea whoami');
      expect(text).toContain('otea profile --model');
      expect(text).toContain('otea create');
      expect(text).toContain('otea wait');
      expect(text).toContain(
        `otea prompt --role worker --board <${lang === 'es' ? 'tablero' : 'board'}>`,
      );
      expect(text).toMatch(lang === 'es' ? /bucle de sondeo propio/ : /polling loop of your own/);
    });
  }

  it('gives a coordinator its name when told, and is written in the language asked', () => {
    const named = rolePrompt('coordinator', 'en', { name: 'ana' });
    expect(named).toContain('your name is ana');
    expect(named).not.toContain('otea whoami');
    expect(rolePrompt('coordinator', 'es', {})).not.toBe(rolePrompt('coordinator', 'en', {}));
    expect(rolePrompt('worker', 'es', { board: 'Cambios' })).toContain('Eres un worker');
  });
});

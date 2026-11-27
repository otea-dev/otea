import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ago, inMinutes, item, NOW } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import type { Agent } from '../presence.ts';
import type { ProjectOverview } from '../types.ts';
import { AgentsMenuBody, ProjectMenuBody, Topbar } from './Topbar.tsx';
import { renderIn, testApp } from './test-app.ts';
import { agentCounts, agentRows, pillSummary, projectRows } from './topbar-model.ts';

afterEach(() => setLanguage('en'));

const opus = { harness: 'claude-code', model: 'opus', effort: 'high', family: 'opus' };

const agent = (name: string, o: Partial<Agent> = {}): Agent => ({
  name,
  harness: null,
  holding: [],
  lastSeen: ago(1),
  live: true,
  ...o,
});
const overview = (o: Partial<ProjectOverview> & { id: string }): ProjectOverview => ({
  name: o.id,
  storage: 'common',
  current: false,
  paths: [{ path: `/repos/${o.id}`, missing: false }] as ProjectOverview['paths'],
  waiting: [],
  withAgents: 0,
  open: 0,
  ...o,
});
const waiting = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `W-${i}` })) as unknown as ProjectOverview['waiting'];

const topbar = (o: Parameters<typeof testApp>[0] = {}) =>
  renderIn(testApp(o), createElement(Topbar));

describe('the topbar', () => {
  it('names the project on its pill, with its monogram on the tile', () => {
    setLanguage('es');
    const html = topbar();
    expect(html).toContain('aria-label="Hollowmere, cambiar de proyecto"');
    expect(html).toContain('<span class="tile" aria-hidden="true">Ho</span>');
    expect(html).toContain('<span class="nm">Hollowmere</span>');
  });

  it('says what waits in other projects, only when something does', () => {
    setLanguage('es');
    const projects = [
      overview({ id: 'hm', current: true }),
      overview({ id: 'a', waiting: waiting(2) }),
      overview({ id: 'b', waiting: waiting(1) }),
    ];
    expect(topbar({ projects })).toContain('3 más te esperan en 2 proyectos');
    expect(topbar({ projects: [overview({ id: 'hm', current: true })] })).not.toContain(
      'elsewhere',
    );
  });

  // Field study 3: «1 más te espera en 1 proyecto» was hidden on the phone, and a question of
  // another project waited 20 minutes. The project pill carries the count there.
  it('says on the phone, on the project pill, that something waits in another project', () => {
    setLanguage('es');
    const projects = [
      overview({ id: 'hm', current: true }),
      overview({ id: 'a', waiting: waiting(2) }),
    ];
    const html = topbar({ projects, phone: true });
    expect(html).toMatch(/class="pelse"[^>]*>2</);
    expect(html).toContain('2 más te esperan en 1 proyecto');
    expect(
      topbar({ projects: [overview({ id: 'hm', current: true })], phone: true }),
    ).not.toContain('class="pelse"');
  });

  it('keeps you in Hablar when you switch project', () => {
    const projects = [
      overview({ id: 'hm', current: true }),
      overview({ id: 'other', name: 'Other' }),
    ];
    const here = { id: 'hm', name: 'Hollowmere' } as Parameters<typeof projectRows>[0];
    const stay = projectRows(here, projects, 0, true, '#/hablar').rows.find((r) => !r.current);
    expect(stay?.href).toBe('/p/other/#/hablar');
    const plain = projectRows(here, projects, 0, true).rows.find((r) => !r.current);
    expect(plain?.href).toBe('/p/other/#/');
  });

  it('fills the mark’s o while something is yours, and turns its orbit while an agent works', () => {
    const quiet = topbar({ all: [item({ id: 'A', turn: 'agent' })] });
    expect(quiet).toContain('class="brand"');
    const busy = topbar({
      all: [
        item({ id: 'A', turn: 'human' }),
        item({ id: 'B', turn: 'agent', lease: { holder: 'Scout', expiresAt: inMinutes(20) } }),
      ],
    });
    expect(busy).toContain('class="brand yours working"');
  });

  it('says how many work, with the total in grey, the halo breathing behind the orbit', () => {
    setLanguage('es');
    const html = topbar({
      agents: [
        agent('Scout', { holding: ['X'], profile: opus }),
        agent('Quill', { profile: opus }),
        agent('Old', { live: false }),
      ],
    });
    expect(html).toContain('<span>1 trabajando</span><small class="wl">de 2</small>');
    // Its name is what it shows, then what it is (WCAG 2.5.3): no label that hides the words.
    expect(html).not.toMatch(/class="apill"[^>]*aria-label=/);
    expect(html).toContain('<span class="visually-hidden"> · Agentes</span>');
    expect(html).toContain('class="amw pulse"');
    expect(html).toContain('class="orb"');
  });

  // An agent on a long command-line step gave no sign for a while: the pill said «Sin agentes»
  // over a menu that did not list it. Through the real wiring, pill and menu now say the same.
  // R2 (field study 4, design): «sin señal» in warn read as a dead agent when the process was most
  // likely at a long step. The pill and the menu say it softly («sin novedades», the words of «sin
  // novedades hace N min»), in ink, never the warn colour: that is for an item stuck.
  it('says «sin novedades» softly on the pill and in the menu for an agent holding a lease that went silent', () => {
    setLanguage('es');
    const silent = agent('Mender', {
      live: false,
      status: 'silent',
      holding: ['ERR-231'],
      profile: opus,
    });
    const html = topbar({ agents: [silent] });
    expect(html).toContain('<span>1 sin novedades</span>');
    expect(html).not.toContain('sin señal');
    expect(html).not.toContain('Sin agentes');
    // Beside a working agent it is the small grey datum, never in warn.
    const busy = topbar({
      agents: [silent, agent('Scout', { holding: ['X'], profile: opus })],
      all: [item({ id: 'X', turn: 'agent', lease: { holder: 'Scout', expiresAt: inMinutes(20) } })],
    });
    expect(busy).toContain('<small class="wl">1 sin novedades</small>');
    expect(busy).not.toContain('warn-t');

    const rows = agentRows([silent], [], NOW);
    const menu = renderIn(
      testApp(),
      createElement(AgentsMenuBody, {
        project: 'Hollowmere',
        rows,
        counts: agentCounts(rows),
        now: NOW,
        onOpen: () => undefined,
        onActivity: () => undefined,
        onConnect: () => undefined,
        onPerformance: () => undefined,
      }),
    );
    expect(menu).toContain('data-agent="Mender"');
    expect(menu).toContain(
      '<span class="verb">sin novedades en</span><span class="id">ERR-231</span>',
    );
    expect(menu).toContain('1 sin novedades');
    expect(menu).not.toContain('sin señal');
    expect(menu).not.toContain('warn');
    expect(menu).not.toContain('Todavía no hay agentes conectados');
  });

  it('says how many wait when nobody works, and that one has no profile', () => {
    setLanguage('es');
    const html = topbar({ agents: [agent('Scout', { profile: opus }), agent('Quill')] });
    expect(html).toContain('<span>2 escuchando</span><small class="wl">1 sin perfil</small>');
    expect(html).not.toContain('pulse');
  });

  it('says Sin agentes with nobody connected', () => {
    setLanguage('es');
    expect(topbar({ agents: [] })).toContain('<span>Sin agentes</span>');
  });

  it('quiets and disables the agents pill while the stream is down', () => {
    setLanguage('es');
    const html = topbar({ connection: 'reconnecting', agents: [agent('Scout')] });
    expect(html).toContain('Sin conexión');
    expect(html).toMatch(/class="apill"[^>]*disabled=""/);
  });

  // P1-R2-8: the header said «Sin conexión» for the first seconds of every page load.
  it('never says Sin conexión while the page first connects', () => {
    setLanguage('es');
    const waiting = topbar({ connection: 'connecting', agents: undefined });
    expect(waiting).not.toContain('Sin conexión');
    expect(waiting).not.toContain('Sin agentes');
    const known = topbar({ connection: 'connecting', agents: [agent('Scout', { profile: opus })] });
    expect(known).not.toContain('Sin conexión');
    expect(known).toContain('1 escuchando');
    // A stream that cannot open says so, even before the agents are known.
    expect(topbar({ connection: 'reconnecting', agents: undefined })).toContain('Sin conexión');
  });

  it('has no agents pill on a server without presence', () => {
    expect(topbar({ agents: null })).not.toContain('apill');
  });
});

describe('the project menu', () => {
  const projects = [
    overview({ id: 'hm', name: 'Hollowmere', current: true }),
    overview({
      id: 'mirefall',
      name: 'Mirefall',
      waiting: waiting(2),
    }),
    overview({ id: 'quiet', name: 'Quiet', unavailable: 'The data is missing' }),
  ];
  const menu = (phone = false) => {
    setLanguage('es');
    const app = testApp({ projects, phone });
    const { rows, total } = projectRows(
      app.project ?? { id: '', name: '', icon: null },
      projects,
      3,
    );
    return renderIn(
      app,
      createElement(ProjectMenuBody, {
        project: 'Hollowmere',
        rows,
        total,
        onClose: () => undefined,
      }),
    );
  };

  it('leads with Todos los proyectos and the total waiting', () => {
    const html = menu();
    expect(html).toContain('Todos los proyectos');
    expect(html).toContain('lo que te toca, en todos lados');
    expect(html).toMatch(/<span class="pw"><i class="dot"><\/i>5<\/span>/);
  });

  it('ticks the project open now, opens another in this window, keeps an unreadable one inert', () => {
    const html = menu();
    expect(html).toMatch(/class="prow cur"[^>]*aria-current="page"/);
    expect(html).toContain('3 te esperan');
    expect(html).toContain('class="tick"');
    expect(html).toContain('<a class="prow" data-i="" href="/p/mirefall/#/">');
    expect(html).not.toContain('_blank');
    expect(html).toMatch(/class="prow inert" data-i="" aria-disabled="true"/);
    expect(html).toContain('no se puede leer ahora');
  });

  it('ends with the project’s settings and how to start another', () => {
    const html = menu();
    expect(html).toContain('configuración de Hollowmere');
    expect(html).toContain('proyecto nuevo: <code>otea init</code> en un repo');
  });

  it('leaves the settings out on the phone: they are on the computer', () => {
    const html = menu(true);
    expect(html).not.toContain('configuración de Hollowmere');
    expect(html).toContain('proyecto nuevo: <code>otea init</code> en un repo');
  });
});

describe('the agents menu', () => {
  const items = [
    item({
      id: 'ERR-231',
      title: 'Huecos en la colisión',
      turn: 'agent',
      lease: { holder: 'Scout', expiresAt: inMinutes(30) },
    }),
    item({
      id: 'CRE-44',
      title: 'Tortuga musgosa',
      turn: 'agent',
      expiredLease: { holder: 'Kiln', expiresAt: ago(12) },
    }),
  ];
  const agents = [
    agent('Scout', {
      harness: 'Claude Code',
      holding: ['ERR-231'],
      profile: opus,
      profileConfirmed: true,
      profileChangedAt: ago(20),
    }),
    agent('Quill'),
    agent('Kiln', {
      harness: 'cli',
      live: false,
      lastSeen: ago(12),
      profile: opus,
      profileConfirmed: false,
    }),
  ];
  const menu = () => {
    setLanguage('es');
    return renderIn(
      testApp(),
      createElement(AgentsMenuBody, {
        project: 'Hollowmere',
        rows: agentRows(agents, items, NOW),
        counts: agentCounts(agentRows(agents, items, NOW)),
        now: NOW,
        onOpen: () => undefined,
        onActivity: () => undefined,
        onConnect: () => undefined,
        onPerformance: () => undefined,
      }),
    );
  };

  // P5-R3-12: the header said «Sin agentes» while an agent held a lease, and the menu's own rule
  // said a lease connects one. Both follow the server's rule (#477): a listener heard, or an otea
  // call within 150 s; a lease alone connects no agent.
  it('states the rule the header counts by: a lease alone connects no agent', () => {
    const html = menu();
    expect(html).toContain(
      'conectado: tiene Otea abierto o lo usó en los últimos dos minutos y medio; tener un ítem en mano no basta. Escucha solo mientras espera trabajo nuevo',
    );
    // P4-F3: no commands or protocol names in the menu's own words.
    expect(html).not.toContain('MCP de Otea está abierto');
    expect(html).not.toContain('otea wait corre');
    const holder = agent('Mender', { holding: ['ERR-231'], live: false, lastSeen: ago(4) });
    const rows = agentRows([holder], items, NOW);
    expect(pillSummary('live', rows)).toEqual({ kind: 'none' });
    setLanguage('en');
    expect(
      renderIn(
        testApp(),
        createElement(AgentsMenuBody, {
          project: 'Hollowmere',
          rows,
          counts: agentCounts(rows),
          now: NOW,
          onOpen: () => undefined,
          onActivity: () => undefined,
          onConnect: () => undefined,
          onPerformance: () => undefined,
        }),
      ),
    ).toContain('holding an item is not enough');
  });

  it('heads with the project and what they do, one away in warn', () => {
    expect(menu()).toContain(
      '<div class="plabel" data-i=""><span>agentes en Hollowmere</span><span class="sum"><b>1 trabajando</b> · 1 escuchando · <span class="warn-t">1 ausente</span></span></div>',
    );
  });

  it('shows each agent with its harness, its profile in mono and what it does now', () => {
    const html = menu();
    expect(html).toContain('<span class="htag">Claude Code</span>');
    expect(html).toContain('<span class="prof">opus <i>·</i> high</span>');
    expect(html).toMatch(/class="held"><svg class="cn"/);
    expect(html).toContain(
      '<span class="verb">trabaja en</span><span class="id">ERR-231</span><span class="tx">Huecos en la colisión</span>',
    );
  });

  // P6-F6: it asked for MCP (otea connect) and its harness never loaded Otea's server. The agent
  // works through the command line, a valid way: the flag is a grey note, never a red warning.
  it('notes in grey an agent whose MCP never connected, saying why on hover', () => {
    setLanguage('es');
    const rows = agentRows([agent('Quill', { mcpMissing: true, profile: opus })], items, NOW);
    const html = renderIn(
      testApp(),
      createElement(AgentsMenuBody, {
        project: 'Hollowmere',
        rows,
        counts: agentCounts(rows),
        now: NOW,
        onOpen: () => undefined,
        onActivity: () => undefined,
        onConnect: () => undefined,
        onPerformance: () => undefined,
      }),
    );
    expect(html).toMatch(
      /<span class="flag soft" title="Pidió conectarse por MCP[^"]*">trabaja por comandos<\/span>/,
    );
    expect(menu()).not.toContain('trabaja por comandos');
  });

  // P6-R2-10: the harness loaded the server, the agent used the command line, and the desk said
  // «MCP sin conectar» as if the config were broken.
  it('says in grey that an agent works by CLI with MCP unused, once its harness loaded it', () => {
    setLanguage('es');
    const rows = agentRows([agent('Quill', { mcp: 'unused', profile: opus })], items, NOW);
    const html = renderIn(
      testApp(),
      createElement(AgentsMenuBody, {
        project: 'Hollowmere',
        rows,
        counts: agentCounts(rows),
        now: NOW,
        onOpen: () => undefined,
        onActivity: () => undefined,
        onConnect: () => undefined,
        onPerformance: () => undefined,
      }),
    );
    expect(html).toMatch(
      /<span class="flag soft" title="Su harness cargó el servidor MCP de Otea[^"]*">trabaja por comandos<\/span>/,
    );
    expect(html).not.toContain('MCP sin');
  });

  // P5-F12: an agent that handed off and is not in otea wait is connected, a calm state; its row
  // was lit in the warning tone as if something failed.
  it('says an agent that is connected but not waiting calmly, not in warn', () => {
    setLanguage('es');
    const rows = agentRows(
      [agent('Quill', { status: 'connected', waiting: false, profile: opus })],
      items,
      NOW,
    );
    const html = renderIn(
      testApp(),
      createElement(AgentsMenuBody, {
        project: 'Hollowmere',
        rows,
        counts: agentCounts(rows),
        now: NOW,
        onOpen: () => undefined,
        onActivity: () => undefined,
        onConnect: () => undefined,
        onPerformance: () => undefined,
      }),
    );
    // One plain statement: the count says «conectado», and the row never says «no escucha».
    expect(html).toContain(
      '<span class="verb">conectado · libre; verá lo nuevo cuando vuelva a esperar</span>',
    );
    expect(html).not.toContain('no escucha');
    expect(html).not.toContain('MCP');
    expect(html).not.toContain('verb warn-t');
  });

  it('marks a profile missing in warn, unconfirmed or just changed in grey', () => {
    const html = menu();
    expect(html).toMatch(/<span class="flag"><svg[\s\S]*?<\/svg>sin perfil<\/span>/);
    expect(html).toContain('no toma pasos hasta declarar modelo y esfuerzo');
    expect(html).toMatch(/<span class="flag soft" title="[^"]+">sin confirmar<\/span>/);
    expect(html).toMatch(/<span class="flag soft">cambió \d\d:\d\d<\/span>/);
  });

  // P6-F1: a lease that ran out leaves the agent away, the server's word for it: «ausente».
  it('warns of an agent away on its expired lease, in the word the server gives', () => {
    const html = menu();
    expect(html).toContain('<span class="htag">claude-code</span>');
    expect(html).toMatch(/class="held warn">.*ausente desde \d\d:\d\d ·/);
    expect(html).not.toContain('sin señal');
  });

  // Review of #605: the lease on CRE-44 ran out, but Kiln is connected and may still be at work on it
  // (lease-take.ts): its row said «escuchando · libre desde…» beside Reasignar.
  it('names the stuck item of a connected agent whose lease ran out, never «libre» or «sin señal»', () => {
    setLanguage('es');
    const body = (rows: ReturnType<typeof agentRows>) =>
      renderIn(
        testApp(),
        createElement(AgentsMenuBody, {
          project: 'Hollowmere',
          rows,
          counts: agentCounts(rows),
          now: NOW,
          onOpen: () => undefined,
          onActivity: () => undefined,
          onConnect: () => undefined,
          onPerformance: () => undefined,
        }),
      );
    const connected = agent('Kiln', { status: 'connected', waiting: false, profile: opus });
    const html = body(agentRows([connected], items, NOW));
    expect(html).toContain(
      '<span class="verb">conectado · se acabó su tiempo en CRE-44</span><span class="tx">Tortuga musgosa</span>',
    );
    expect(html).not.toContain('libre');
    expect(html).not.toContain('sin señal');
    const listening = { ...connected, status: 'listening' as const, waiting: true };
    expect(body(agentRows([listening], items, NOW))).toContain(
      '<span class="verb">escuchando · se acabó su tiempo en CRE-44</span>',
    );
    setLanguage('en');
    expect(body(agentRows([connected], items, NOW))).toContain(
      'connected · its lease on CRE-44 ran out',
    );
  });

  it('opens the agent’s sheet from its whole row', () => {
    expect(menu()).toMatch(/<button type="button" class="arow" data-i="" data-agent="Scout"/);
  });

  it('offers the activity and how to connect another, then says what connected means', () => {
    const html = menu();
    expect(html).toContain(
      '<b>Ver actividad</b><small>reservas en curso, los últimos eventos</small>',
    );
    expect(html).toContain(
      '<b>Conectar un agente</b><small>una instrucción para pegar en su chat</small>',
    );
    expect(html).toContain(
      'conectado: tiene Otea abierto o lo usó en los últimos dos minutos y medio',
    );
  });
});

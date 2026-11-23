import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPerformance } from './api.ts';
import { AcrossAgents } from './components/ProjectsInbox.tsx';
import { setLanguage } from './i18n/i18n.ts';
import { agentsAcross } from './projects.ts';
import type { ProjectAgent, ProjectOverview } from './types.ts';

// P6-F3: the agents of every project in «Todos los proyectos», and Rendimiento over all of them.
// The status of each agent is the server's; nothing here works one out.

afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

const agent = (name: string, status: ProjectAgent['status'], holding = 0): ProjectAgent => ({
  name,
  status,
  holding,
});

const project = (name: string, over: Partial<ProjectOverview> = {}): ProjectOverview => ({
  id: `${name.toLowerCase()}-aaaaaa`,
  name,
  storage: 'common',
  current: false,
  paths: [],
  waiting: [],
  withAgents: 0,
  open: 0,
  ...over,
});

const projects = [
  project('Alfa', {
    current: true,
    agents: [agent('kiln', 'working', 2), agent('scout', 'listening')],
  }),
  project('Beta', {
    agents: [agent('kiln', 'silent', 1), agent('quill', 'connected'), agent('ghost', 'away')],
  }),
  project('Gamma', { unavailable: 'gone', agents: [agent('lost', 'working')] }),
  project('Delta'),
];

describe('the agents across projects', () => {
  it('lists each agent the server gives for each project, away ones too, those that need a look first', () => {
    expect(agentsAcross(projects).map((a) => `${a.name}@${a.project.name}:${a.status}`)).toEqual([
      'kiln@Beta:silent',
      'ghost@Beta:away',
      'kiln@Alfa:working',
      'scout@Alfa:listening',
      'quill@Beta:connected',
    ]);
  });

  it('draws them with the server’s word for each, and the project as a link to its page', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(createElement(AcrossAgents, { projects }));
    expect(html).toContain('Agentes');
    expect(html).toContain('en todos los proyectos');
    expect(html).toMatch(
      /data-status="silent"[^>]*>.*sin señal.*<a href="\/p\/beta-aaaaaa\/#\/">Beta/,
    );
    expect(html).toMatch(/data-status="working"[^>]*>.*trabajando.*<a href="#\/">Alfa/);
    expect(html).toContain('con 2 ítems');
    expect(html).toMatch(/data-status="away"[^>]*>.*ghost.*ausente/);
    expect(html).not.toContain('lost');
  });

  it('draws nothing while no agent is connected anywhere', () => {
    expect(
      renderToStaticMarkup(createElement(AcrossAgents, { projects: [project('Delta')] })),
    ).toBe('');
  });
});

describe('Rendimiento across projects', () => {
  const asked = () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('{}', { status: 200 });
      }),
    );
    return urls;
  };

  it('asks the server for every project, and never sends a board it cannot mean', async () => {
    const urls = asked();
    const signal = new AbortController().signal;
    await fetchPerformance({ board: 'Bugs', since: '30d', all: true }, signal);
    await fetchPerformance({ board: 'Bugs', since: '30d' }, signal);
    expect(urls[0]).toContain('projects=all');
    expect(urls[0]).not.toContain('board=');
    expect(urls[1]).toContain('board=Bugs');
    expect(urls[1]).not.toContain('projects=');
  });
});

import { describe, expect, it } from 'vitest';
import {
  inboxOf,
  itemHref,
  placeOf,
  projectHref,
  sizeLabel,
  waitingElsewhere,
  whereOf,
} from './projects.ts';
import type { ProjectOverview, WaitingItem } from './types.ts';

const item = (id: string): WaitingItem => ({
  id,
  collection: 'tasks',
  type: 'task',
  title: id,
  fields: {},
  presetVersion: 1,
  state: 'review',
  turn: 'human',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  createdBy: { kind: 'agent', name: 'claude' },
  lease: null,
});

const project = (name: string, over: Partial<ProjectOverview> = {}): ProjectOverview => ({
  id: `${name}-aaaaaa`,
  name,
  storage: 'common',
  current: false,
  paths: [{ path: `/work/${name}`, kind: 'repo', missing: false }],
  waiting: [],
  withAgents: 0,
  open: 0,
  ...over,
});

// F4 review round: a project whose only waiting thing is a refiner's question on a note is a
// project with something waiting for you.
describe('what waits that is no item, across projects', () => {
  const asks = {
    kind: 'bandeja' as const,
    ref: 'B-1',
    title: 'the button',
    since: null,
    text: 'Which screen?',
  };

  it('puts a project with only a question in the inbox and counts it', () => {
    const quiet = project('quiet');
    const asking = project('tandas', { asking: [asks] });

    expect(inboxOf([quiet, asking]).groups).toEqual([asking]);
    expect(inboxOf([quiet, asking]).waiting).toBe(1);
  });

  it('counts it beside the switcher, with the items', () => {
    const mixed = project('mixed', { waiting: [item('A-1')], asking: [asks, asks] });

    expect(waitingElsewhere([mixed])).toEqual({ count: 3, projects: 1 });
  });
});

describe('the projects inbox', () => {
  const projects = [
    project('api', {
      current: true,
      waiting: [item('TASKS-1'), item('TASKS-2')],
      open: 3,
      withAgents: 1,
    }),
    project('web', {
      waiting: [item('BUGS-7')],
      open: 4,
      withAgents: 3,
    }),
    project('dotfiles'),
    project('gone', { unavailable: 'The data is missing' }),
  ];

  it('groups what waits for you by project and says what stays out', () => {
    const inbox = inboxOf(projects);
    expect(inbox.waiting).toBe(3);
    expect(inbox.groups.map((group) => group.name)).toEqual(['api', 'web']);
    expect(inbox.withAgents).toBe(4);
    expect(inbox.agentProjects).toEqual(['api', 'web']);
    expect(inbox.idle).toEqual(['dotfiles']);
    expect(inbox.unavailable.map((group) => group.name)).toEqual(['gone']);
  });

  it('counts what waits outside the project served here', () => {
    expect(waitingElsewhere(projects)).toEqual({ count: 1, projects: 1 });
  });

  it("leads a row here, or to its project's page on this same server", () => {
    const [api, web] = projects;
    expect(api && itemHref(api, item('TASKS-1'))).toBe('#TASKS-1');
    expect(web && itemHref(web, item('BUGS-7'))).toBe('/p/web-aaaaaa/#BUGS-7');
    expect(web && projectHref(web)).toBe('/p/web-aaaaaa/#/');
  });

  it('names where a project lives by its first path still there', () => {
    expect(
      whereOf({
        paths: [
          { path: '/old', kind: 'repo', missing: true },
          { path: '/new', kind: 'repo', missing: false },
        ],
      }),
    ).toBe('/new');
  });

  it.each([
    [512, '512 B'],
    [4_404_019, '4.2 MB'],
    [134_217_728, '128 MB'],
  ])('writes %d bytes as %s', (bytes, label) => {
    expect(sizeLabel(bytes)).toBe(label);
  });
});

// field study 4 (design): a project's folder was its dek as a raw temp path, cut mid-word.
describe('placeOf', () => {
  it.each([
    ['C:\\Users\\ana\\code\\shop', '~/code/shop'],
    ['/home/ana/work/clients/acme/shop', '~/…/acme/shop'],
    ['C:\\Users\\ana\\AppData\\Local\\Temp\\claude\\run\\scratchpad\\dw\\repo2', '~/…/dw/repo2'],
    ['/srv/app', '/srv/app'],
    ['/var/lib/otea/projects/shop/', '/…/projects/shop'],
  ])('says %s as %s', (path, shown) => {
    expect(placeOf(path)).toBe(shown);
  });
});

import type { AgentStatus } from '../../src/core/agent-status.ts';
import { projectPage } from './base.ts';
import { hashFor } from './selection.ts';
import type { ProjectOverview, WaitingItem } from './types.ts';

// An agent in one of the projects, with the server's status for it there (core/agent-status.ts).
export type AcrossAgent = {
  name: string;
  status: AgentStatus;
  holding: number;
  project: Pick<ProjectOverview, 'id' | 'name' | 'current'>;
};

// What needs a look first: no signal, then away (it left an item stuck), then at work, then
// waiting, then merely connected.
const ATTENTION: readonly AgentStatus[] = ['silent', 'away', 'working', 'listening', 'connected'];

// The agents of every readable project, the ones that need a look first. The same agent working in
// two projects is two rows: each is its own session of work. The server lists an away agent only
// while it has an item stuck; every one it lists is shown, in the word it has everywhere.
export function agentsAcross(projects: readonly ProjectOverview[]): AcrossAgent[] {
  return projects
    .filter((project) => project.unavailable === undefined)
    .flatMap((project) =>
      (project.agents ?? []).map((agent) => ({
        name: agent.name,
        status: agent.status,
        holding: agent.holding,
        project: { id: project.id, name: project.name, current: project.current },
      })),
    )
    .sort(
      (a, b) =>
        ATTENTION.indexOf(a.status) - ATTENTION.indexOf(b.status) ||
        a.project.name.localeCompare(b.project.name) ||
        a.name.localeCompare(b.name),
    );
}

// What the projects inbox shows: the projects with something waiting for you, in the registry's
// order, and what stays out of it (items with agents, projects with nothing open).
export type Inbox = {
  waiting: number;
  groups: ProjectOverview[];
  withAgents: number;
  // The projects that hold the items with agents.
  agentProjects: string[];
  // The projects with nothing open at all.
  idle: string[];
  // The projects whose items could not be read.
  unavailable: ProjectOverview[];
};

export function inboxOf(projects: readonly ProjectOverview[]): Inbox {
  const readable = projects.filter((project) => project.unavailable === undefined);
  const groups = readable.filter((project) => project.waiting.length > 0);
  const agents = readable.filter((project) => project.withAgents > 0);
  return {
    waiting: groups.reduce((sum, project) => sum + project.waiting.length, 0),
    groups,
    withAgents: agents.reduce((sum, project) => sum + project.withAgents, 0),
    agentProjects: agents.map((project) => project.name),
    idle: readable.filter((project) => project.open === 0).map((project) => project.name),
    unavailable: projects.filter((project) => project.unavailable !== undefined),
  };
}

// What waits for you outside the project this server serves: for a line beside the switcher.
export function waitingElsewhere(projects: readonly ProjectOverview[]): {
  count: number;
  projects: number;
} {
  const others = projects.filter((project) => !project.current && project.waiting.length > 0);
  return {
    count: others.reduce((sum, project) => sum + project.waiting.length, 0),
    projects: others.length,
  };
}

// Where a row of the inbox leads: the item, here or on its project's page of this same server.
export function itemHref(project: ProjectOverview, item: WaitingItem): string {
  if (project.current) return hashFor(item.id);
  return projectPage(project.id, hashFor(item.id));
}

// `stay`: the hash to open the other project at (Hablar stays Hablar when you switch).
export function projectHref(
  project: Pick<ProjectOverview, 'id' | 'current'>,
  stay?: string,
): string {
  if (project.current) return '#/';
  return projectPage(project.id, stay);
}

// The first path of a project that is still there, to name where it lives.
export function whereOf(project: Pick<ProjectOverview, 'paths'>): string | undefined {
  return (project.paths.find((path) => !path.missing) ?? project.paths[0])?.path;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

// A size in bytes, in the largest unit that keeps it at 1 or more, with one decimal under 10.
export function sizeLabel(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${UNITS[unit]}`;
}

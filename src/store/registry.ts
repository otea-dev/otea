import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RepoFingerprint } from '../core/repo.ts';
import { applyMigrations } from './migrations.ts';

// The user-level list of projects and the folders that lead to them. A project can have several
// paths (a product folder, or separate repos linked to one project); a path belongs to one project.
const REGISTRY_MIGRATIONS = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    storage TEXT NOT NULL CHECK (storage IN ('common', 'local')),
    data_dir TEXT NOT NULL
  );

  CREATE TABLE project_paths (
    path_key TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    kind TEXT NOT NULL CHECK (kind IN ('folder', 'repo'))
  );

  CREATE INDEX project_paths_project_id ON project_paths (project_id);
  `,
  // What identified a linked repo when it was linked, so a relink can tell it is the same repo
  // even after the old folder is gone.
  `
  ALTER TABLE project_paths ADD COLUMN remote_url TEXT;
  ALTER TABLE project_paths ADD COLUMN root_commit TEXT;
  `,
  // The project an agent name works in (app/agent-home.ts): ids repeat across projects, so what
  // an agent may write is the project it is at work in, never the one its current folder is.
  `
  CREATE TABLE agent_homes (
    name TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    data_dir TEXT NOT NULL,
    at TEXT NOT NULL
  );
  `,
  // The harness process a session runs under, when the call knew it (an MCP server's parent): a
  // new one is a new session of the agent, which may take the name to another project.
  `
  ALTER TABLE agent_homes ADD COLUMN launcher INTEGER;
  `,
];

export function migrateRegistry(db: DatabaseSync): void {
  applyMigrations(db, REGISTRY_MIGRATIONS);
}

export type Storage = 'common' | 'local';

export type RegisteredProject = { id: string; name: string; storage: Storage; dataDir: string };

export type PathKind = 'folder' | 'repo';

export type ProjectPath = RepoFingerprint & {
  path: string;
  pathKey: string;
  projectId: string;
  kind: PathKind;
};

type ProjectRow = { id: string; name: string; storage: Storage; data_dir: string };

type PathRow = {
  path: string;
  path_key: string;
  project_id: string;
  kind: PathKind;
  remote_url: string | null;
  root_commit: string | null;
};

// The Otea home the registry lives in (its folder), '' for a registry kept in memory.
export function homeOf(db: DatabaseSync): string {
  const databases = db.prepare('PRAGMA database_list').all() as { name: string; file: string }[];
  const file = databases.find((each) => each.name === 'main')?.file ?? '';
  return file === '' ? '' : dirname(file);
}

// A data folder inside the home is kept relative to it, so a home that is copied or moved uses its
// own data; one anywhere else (a project's own .otea) is kept as it is.
function storedDataDir(home: string, dataDir: string): string {
  if (home === '' || !isAbsolute(dataDir)) return dataDir;
  const inside = relative(home, dataDir);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return dataDir;
  return inside.split(sep).join('/');
}

function readDataDir(home: string, stored: string): string {
  return home === '' || isAbsolute(stored) ? stored : resolve(home, stored);
}

export function insertRegisteredProject(db: DatabaseSync, project: RegisteredProject): void {
  db.prepare('INSERT INTO projects (id, name, storage, data_dir) VALUES (?, ?, ?, ?)').run(
    project.id,
    project.name,
    project.storage,
    storedDataDir(homeOf(db), project.dataDir),
  );
}

function toProject(row: ProjectRow, home: string): RegisteredProject {
  return {
    id: row.id,
    name: row.name,
    storage: row.storage,
    dataDir: readDataDir(home, row.data_dir),
  };
}

export function selectRegisteredProject(
  db: DatabaseSync,
  id: string,
): RegisteredProject | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row && toProject(row, homeOf(db));
}

export function selectRegisteredProjects(db: DatabaseSync): RegisteredProject[] {
  const home = homeOf(db);
  const rows = db.prepare('SELECT * FROM projects ORDER BY name, id').all() as ProjectRow[];
  return rows.map((row) => toProject(row, home));
}

// The data folders of the rows that still hold a whole path, for a home that was moved or copied
// to take back (anchorDataDirs in app/home.ts): the project ids with the path each was given.
export function wholeDataDirs(db: DatabaseSync): { id: string; dataDir: string }[] {
  const rows = db.prepare('SELECT id, data_dir FROM projects').all() as {
    id: string;
    data_dir: string;
  }[];
  const homes = db.prepare('SELECT DISTINCT project_id AS id, data_dir FROM agent_homes').all() as {
    id: string;
    data_dir: string;
  }[];
  return [...rows, ...homes]
    .filter((row) => isAbsolute(row.data_dir))
    .map((row) => ({ id: row.id, dataDir: row.data_dir }));
}

// Keeps a data folder that lies inside the home relative to it, where the path was `from`.
export function anchorDataDir(db: DatabaseSync, id: string, from: string, to: string): void {
  db.prepare('UPDATE projects SET data_dir = ? WHERE id = ? AND data_dir = ?').run(to, id, from);
  db.prepare('UPDATE agent_homes SET data_dir = ? WHERE project_id = ? AND data_dir = ?').run(
    to,
    id,
    from,
  );
}

export function insertProjectPath(db: DatabaseSync, path: ProjectPath): void {
  db.prepare(
    `INSERT INTO project_paths (path_key, path, project_id, kind, remote_url, root_commit)
    VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(path.pathKey, path.path, path.projectId, path.kind, path.remoteUrl, path.rootCommit);
}

// Moves a link to another folder, keeping its project.
export function updateProjectPath(db: DatabaseSync, oldKey: string, path: ProjectPath): void {
  db.prepare(
    `UPDATE project_paths SET path_key = ?, path = ?, kind = ?, remote_url = ?, root_commit = ?
    WHERE path_key = ?`,
  ).run(path.pathKey, path.path, path.kind, path.remoteUrl, path.rootCommit, oldKey);
}

export function deleteProjectPath(db: DatabaseSync, pathKey: string): void {
  db.prepare('DELETE FROM project_paths WHERE path_key = ?').run(pathKey);
}

export function deleteRegisteredProject(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM project_paths WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM agent_homes WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// The project an agent name was last at work in, and where that project's data is.
export type AgentHome = {
  name: string;
  projectId: string;
  projectName: string;
  dataDir: string;
  // When a write, a claim or a connect of it last kept the home.
  at: string;
  launcher: number | null;
};

export function selectAgentHome(db: DatabaseSync, name: string): AgentHome | undefined {
  const home = homeOf(db);
  const row = db.prepare('SELECT * FROM agent_homes WHERE name = ?').get(name) as
    | {
        name: string;
        project_id: string;
        project_name: string;
        data_dir: string;
        at: string;
        launcher: number | null;
      }
    | undefined;
  return (
    row && {
      name: row.name,
      projectId: row.project_id,
      projectName: row.project_name,
      dataDir: readDataDir(home, row.data_dir),
      at: row.at,
      launcher: row.launcher,
    }
  );
}

export function upsertAgentHome(db: DatabaseSync, home: AgentHome): void {
  db.prepare(
    `INSERT INTO agent_homes (name, project_id, project_name, data_dir, at, launcher)
    VALUES (:name, :projectId, :projectName, :dataDir, :at, :launcher)
    ON CONFLICT (name) DO UPDATE SET project_id = excluded.project_id,
      project_name = excluded.project_name, data_dir = excluded.data_dir, at = excluded.at,
      launcher = excluded.launcher`,
  ).run({ ...home, dataDir: storedDataDir(homeOf(db), home.dataDir) });
}

export function selectProjectPaths(db: DatabaseSync): ProjectPath[] {
  const rows = db.prepare('SELECT * FROM project_paths ORDER BY path_key').all() as PathRow[];
  return rows.map((row) => ({
    path: row.path,
    pathKey: row.path_key,
    projectId: row.project_id,
    kind: row.kind,
    remoteUrl: row.remote_url,
    rootCommit: row.root_commit,
  }));
}

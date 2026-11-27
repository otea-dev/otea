import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addCollection } from './collections.ts';
import { openRegistry } from './home.ts';
import { createItem, listItems } from './items.ts';
import { initProject, openProject, type Project } from './project.ts';

// Field study 4, T1b: the registry stored the absolute folder of a project's data, so a copied or
// moved Otea home kept using the old folder's data. What lives inside the home is kept relative to
// it; a row an older Otea wrote (absolute, inside the old home) is read as relative once the same
// folder exists under the current home, and what points outside the home is never touched.
describe('a copied or moved Otea home', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  const tempDir = () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-home-')));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  const track = (project: Project) => {
    cleanups.push(() => {
      try {
        project.db.close();
      } catch {
        // Closed by the test.
      }
    });
    return project;
  };

  // A repo with a project in the common storage of `home`, with one item in it.
  function projectIn(home: string): { repo: string; project: Project } {
    const repo = tempDir();
    execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
    const project = track(initProject(repo, {}, { OTEA_HOME: home }));
    addCollection(project, { name: 'tasks' });
    createItem(project, {
      collection: 'tasks',
      title: 'Original',
      actor: { kind: 'human', name: 'human' },
    });
    return { repo, project };
  }

  const titles = (repo: string, home: string) =>
    listItems(track(openProject(repo, { OTEA_HOME: home }))).map((item) => item.title);

  it('uses its own data, not the folder of the home it was copied from', () => {
    const home = tempDir();
    const { repo, project } = projectIn(home);
    project.db.close();
    const copy = join(tempDir(), 'copy');
    cpSync(home, copy, { recursive: true });

    const opened = track(openProject(repo, { OTEA_HOME: copy }));
    createItem(opened, {
      collection: 'tasks',
      title: 'Only in the copy',
      actor: { kind: 'human', name: 'human' },
    });

    expect(opened.dataDir).toBe(join(copy, 'data', opened.identity.id));
    expect(titles(repo, copy)).toEqual(['Original', 'Only in the copy']);
    expect(titles(repo, home)).toEqual(['Original']);
  });

  it('reads a row an older Otea wrote (absolute, in the old home) as inside the current one', () => {
    const home = tempDir();
    const { repo, project } = projectIn(home);
    const { id } = project.identity;
    project.db.close();
    const registry = openRegistry({ OTEA_HOME: home });
    // As Otea 0.7 wrote it: the whole path.
    registry
      .prepare('UPDATE projects SET data_dir = ? WHERE id = ?')
      .run(join(home, 'data', id), id);
    registry.close();
    const copy = join(tempDir(), 'copy');
    cpSync(home, copy, { recursive: true });

    const opened = track(openProject(repo, { OTEA_HOME: copy }));

    expect(opened.dataDir).toBe(join(copy, 'data', id));
  });

  it('never touches a row that points outside the home', () => {
    const home = tempDir();
    const { repo, project } = projectIn(home);
    const { id } = project.identity;
    project.db.close();
    const elsewhere = join(tempDir(), 'my-project-data');
    cpSync(join(home, 'data', id), elsewhere, { recursive: true });
    const registry = openRegistry({ OTEA_HOME: home });
    registry.prepare('UPDATE projects SET data_dir = ? WHERE id = ?').run(elsewhere, id);
    registry.close();

    // The data the row names lives there, outside this home: it is what is opened.
    const opened = track(openProject(repo, { OTEA_HOME: home }));

    expect(opened.dataDir).toBe(elsewhere);
    const check = openRegistry({ OTEA_HOME: home });
    expect(check.prepare('SELECT data_dir FROM projects').get()?.data_dir).toBe(elsewhere);
    check.close();
  });
});

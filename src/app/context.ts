import type { DatabaseSync } from 'node:sqlite';
import type { PresetCatalog } from './presets.ts';

// The files a branch changes over its base, as the repository has them pushed (no fetch): sorted
// paths, or undefined when it cannot be told (the branch is not pushed, git is not there).
export type FilesChanged = (branch: string, base: string) => string[] | undefined;

export type Context = {
  db: DatabaseSync;
  presets: PresetCatalog;
  // Where git is asked about the files two items' branches share (app/overlap.ts); a project in a
  // checkout has it, anything else says nothing about overlap.
  changed?: FilesChanged;
};

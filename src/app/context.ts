import type { DatabaseSync } from 'node:sqlite';
import type { PresetCatalog } from './presets.ts';

// The files a branch changes over its base, as the repository has them pushed (no fetch): sorted
// paths, or undefined when it cannot be told (the branch is not pushed, git is not there).
export type FilesChanged = (branch: string, base: string) => string[] | undefined;

// Where each of `branches` and the base stand (one read of the refs), as one string: it changes
// when any of them moves, so what was worked out from them can be reused until it does.
export type BranchStamp = (branches: readonly string[], base: string) => string | undefined;

export type Context = {
  db: DatabaseSync;
  presets: PresetCatalog;
  // Where git is asked about the files two items' branches share (app/overlap.ts); a project in a
  // checkout has them, anything else says nothing about overlap.
  changed?: FilesChanged;
  stamp?: BranchStamp;
};

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

// Whether a field of a board says where the work lives: a web address field, or a text field the
// board named for a file or a path («Archivo», «Ruta», «File path»). A board has no field type for a
// path, so its name is what says so.
const PLACE_NAME = /\b(archivos?|ficheros?|rutas?|carpetas?|files?|paths?|folders?)\b/i;
export function saysWhereItLives(part: { kind: string; name: string }): boolean {
  return (
    part.kind === 'url' ||
    ((part.kind === 'text' || part.kind === 'long') && PLACE_NAME.test(part.name))
  );
}

// Where a piece of work says it lives (a content board's «Publicado en»), checked against what the
// person can read (field study 4, U3: six of six pieces closed as Done while their text sat on a side
// branch in a worktree, and one even wrote «todavía no está en tu carpeta»). A web address is where
// it went live and is taken as it is; anything else must be a file in the project's own folder, which
// is where the person reads. Returns why it is not, or undefined when it is.
export function unreachedWhere(root: string, written: string): string | undefined {
  const value = written.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (value === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^mailto:/i.test(value))
    return undefined;
  const path = value.replace(/[?#].*$/, '');
  const full = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const inside = relative(resolve(root), full);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
    return `"${written.trim()}" is not a file inside the project's folder (${root})`;
  const parts = inside.split(sep);
  if (parts[0] === '.otea' || parts[0] === '.git')
    return `"${written.trim()}" is inside ${parts[0]}, which is not where the person reads: a worktree or a side branch holds it, not their folder`;
  try {
    if (existsSync(full) && statSync(full).isFile()) return undefined;
  } catch {
    // Unreadable: it is not there for the person either.
  }
  return `there is no file "${written.trim()}" in the project's folder (${root})`;
}

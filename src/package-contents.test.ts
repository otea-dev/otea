import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// What npm publishes is what a person who installs it reads: a link in the README to a page or an
// image that is not in the package is broken offline and inside node_modules (P1-F5, P3-F1, P8-F11).
// Every relative link and image of the READMEs, and of the pages they ship, must name a file the
// package holds; a link to anything else is absolute.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The paths the tarball would hold, from npm's own dry run (no scripts: nothing is built).
function packed(): Set<string> {
  const out = execSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const [pack] = JSON.parse(out) as [{ files: { path: string }[] }];
  return new Set(pack.files.map(({ path }) => path));
}

// The relative targets a Markdown page links to or draws, without their #anchor.
function relativeTargets(page: string): string[] {
  const text = readFileSync(`${ROOT}/${page}`, 'utf8');
  const found = [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? ''),
    ...[...text.matchAll(/\b(?:src|srcset)="([^"\s]+)"/g)].map((m) => m[1] ?? ''),
  ];
  return found
    .filter((target) => !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target))
    .map((target) => posix.join(posix.dirname(page), target.split('#')[0] ?? ''))
    .filter((path) => path !== '.' && path !== '');
}

describe('the package', () => {
  const files = packed();
  const holds = (path: string) =>
    files.has(path) || (path.endsWith('/') && [...files].some((file) => file.startsWith(path)));
  const pages = [
    'README.md',
    'README.es.md',
    'SECURITY.md',
    ...[...files].filter((f) => /^docs\/.*\.md$/.test(f)),
  ];

  it.each(pages)('holds everything %s links to or draws', (page) => {
    const missing = relativeTargets(page).filter((path) => !holds(path));

    expect(missing).toEqual([]);
  });

  it('has the pages and images the README names', () => {
    // Guards the check itself: a README with no relative links would pass it for nothing.
    expect(relativeTargets('README.md')).toContain('docs/mcp.md');
    expect(relativeTargets('README.md')).toContain('docs/images/desk-review-light.png');
    expect(files.has('SECURITY.md')).toBe(true);
  });
});

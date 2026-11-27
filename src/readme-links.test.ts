import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The READMEs are the first thing a newcomer reads (field study 4: ~25 minutes to a first reply).
// Every link in them must land: a file that exists, and a heading that exists in it.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Markdown outside fenced code, so a command in a block is never read as a link.
function prose(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .filter((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      return !fenced && !/^\s*```/.test(line);
    })
    .join('\n');
}

// GitHub's anchor of a heading: lower case, anything but letters, digits, spaces, hyphens and
// underscores dropped, spaces to hyphens; a heading that repeats gets -1, -2.
function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const line of prose(markdown).split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = heading
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

function linksOf(markdown: string): string[] {
  return [...prose(markdown).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
    (match) => match[1] ?? '',
  );
}

describe.each(['README.md', 'README.es.md'])('the links of %s', (name) => {
  const file = join(ROOT, name);
  const markdown = readFileSync(file, 'utf8');

  it('land on a file that exists and a heading that exists in it', () => {
    const broken: string[] = [];
    for (const link of linksOf(markdown)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // https:, mailto:
      const [path = '', hash] = link.split('#');
      const target = path === '' ? file : join(dirname(file), path);
      if (!existsSync(target)) {
        broken.push(`${link} (no such file)`);
        continue;
      }
      if (hash !== undefined && /\.md$/i.test(target)) {
        if (!anchors(readFileSync(target, 'utf8')).has(hash)) broken.push(`${link} (no heading)`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('the first steps of the READMEs', () => {
  it('end Start in a minute with the secretary, in both languages', () => {
    const english = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const start = english.slice(english.indexOf('## Start in a minute'));
    const steps = start.slice(0, start.indexOf('\n## ', 5));
    expect(steps).toMatch(/3\. \*\*Meet your secretary\.\*\*/);
    expect(steps).toContain('otea prompt --role secretary');
    expect(steps).toContain('1-2 minutes');

    const spanish = readFileSync(join(ROOT, 'README.es.md'), 'utf8');
    const empezar = spanish.slice(spanish.indexOf('## Empezar en un minuto'));
    const pasos = empezar.slice(0, empezar.indexOf('\n## ', 5));
    expect(pasos).toMatch(/3\. \*\*Conoce a tu secretario\.\*\*/);
    expect(pasos).toContain('otea prompt --role secretary');
    expect(pasos).toContain('1-2 minutos');
  });

  it('give the two-line pitch under the tagline, and name no coordinator', () => {
    const english = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(english.indexOf('You talk with one agent, your secretary')).toBeLessThan(
      english.indexOf('## Start in a minute'),
    );
    for (const name of ['README.md', 'README.es.md']) {
      expect(readFileSync(join(ROOT, name), 'utf8')).not.toMatch(/coordinator|coordinador/i);
    }
  });

  it('never show the English README a Spanish name for a page', () => {
    const english = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(english).not.toMatch(/Hablar|Bandeja|Te toca/);
  });
});

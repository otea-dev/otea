import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_FILES, ICONS_RECORD, iconsRecord } from './icon-files.ts';
import { ICON_SIZES } from './marks.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(REPO, path));

const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('the icon files Otea ships', () => {
  it('were rendered from the drawings marks.ts makes today (npm run icons)', () => {
    expect(JSON.parse(read(ICONS_RECORD).toString())).toEqual(iconsRecord());
  });

  it.each(
    ICON_FILES.flatMap((file) => (file.kind === 'png' ? [[file.path, file.size] as const] : [])),
  )('%s is a %ipx PNG', (path, size) => {
    const png = read(path);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(pngSize(png)).toEqual([size, size]);
  });

  it('gives Otea.exe, its shortcut and its installer every size Windows asks for', () => {
    const ico = read('desktop/build/icon.ico');
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => ico.readUInt8(6 + 16 * index) || 256);
    expect(sizes).toEqual([...ICON_SIZES]);
    for (let index = 0; index < count; index++) {
      const offset = ico.readUInt32LE(6 + 16 * index + 12);
      const png = ico.subarray(offset);
      expect(pngSize(png)).toEqual([sizes[index], sizes[index]]);
    }
    const builder = read('desktop/electron-builder.yml').toString();
    // The `win:` block, comments aside: nsis first, then the icon (read by line, so no pattern can backtrack).
    const win = builder
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#'));
    const at = win.indexOf('win:');
    expect(win.slice(at + 1, at + 3)).toEqual(['target: nsis', 'icon: build/icon.ico']);
  });
});

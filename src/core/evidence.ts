// Before/after pairs carry no pair id: a viewer pairs the latest before with the latest after.
export const EVIDENCE_ROLES = ['before', 'after', 'single'] as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export type EvidenceKind = 'image' | 'video' | 'audio' | 'diff' | 'log' | 'diagram' | 'file';

export type EvidenceType = { kind: EvidenceKind; contentType: string };

export const MAX_EVIDENCE_MB = 50;

export const MAX_EVIDENCE_BYTES = MAX_EVIDENCE_MB * 1024 * 1024;

// Only formats a browser renders without running anything are images, videos and audio. SVG is a
// document that can carry scripts, so it stays an opaque file the server only offers as a download.
const TYPES: Readonly<Record<string, EvidenceType>> = {
  gif: { kind: 'image', contentType: 'image/gif' },
  png: { kind: 'image', contentType: 'image/png' },
  jpg: { kind: 'image', contentType: 'image/jpeg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg' },
  webp: { kind: 'image', contentType: 'image/webp' },
  mp4: { kind: 'video', contentType: 'video/mp4' },
  webm: { kind: 'video', contentType: 'video/webm' },
  mov: { kind: 'video', contentType: 'video/quicktime' },
  mp3: { kind: 'audio', contentType: 'audio/mpeg' },
  wav: { kind: 'audio', contentType: 'audio/wav' },
  ogg: { kind: 'audio', contentType: 'audio/ogg' },
  diff: { kind: 'diff', contentType: 'text/x-diff' },
  patch: { kind: 'diff', contentType: 'text/x-diff' },
  log: { kind: 'log', contentType: 'text/plain' },
  txt: { kind: 'log', contentType: 'text/plain' },
  // A Mermaid diagram is its source: text the diagram module draws, never a page the browser runs.
  mmd: { kind: 'diagram', contentType: 'text/plain' },
  mermaid: { kind: 'diagram', contentType: 'text/plain' },
  svg: { kind: 'file', contentType: 'image/svg+xml' },
};

export const EVIDENCE_FILE_KINDS: readonly EvidenceKind[] = [
  'image',
  'video',
  'audio',
  'diff',
  'log',
  'diagram',
  'file',
];

// The extensions Otea reads as a kind, in the order it lists them to someone attaching. The opaque
// kind (`file`) names none: it is any other extension.
export function extensionsOf(kind: EvidenceKind): string[] {
  if (kind === 'file') return [];
  return Object.entries(TYPES).flatMap(([extension, type]) =>
    type.kind === kind ? [extension] : [],
  );
}

const OPAQUE: EvidenceType = { kind: 'file', contentType: 'application/octet-stream' };

// The most a name made for the disk keeps, so a path built from it stays within what file systems take.
const MAX_SAFE_NAME = 120;

// Names Windows opens as a device whatever the extension: CON.txt is the console.
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// A name as a file on disk, for a path an agent opens: what Windows and Unix both take, whatever
// the file was called where it came from. Characters a path cannot hold and control characters
// become "_"; leading spaces, trailing dots and spaces go; a name left with nothing (a lone space)
// is "file"; a device name (CON, NUL, COM1...) gets a "_" before it; a very long one is cut,
// keeping its extension. The name it came with is kept apart, to show.
export function safeFileName(name: string): string {
  const cleaned = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character,
  )
    .join('')
    .replace(/^\s+/, '')
    .replace(/[. ]+$/, '');
  if (cleaned === '') return 'file';
  const dot = cleaned.lastIndexOf('.');
  // A long "extension" is no extension: it is part of a long name.
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : '';
  const stem = (extension === '' ? cleaned : cleaned.slice(0, dot))
    .slice(0, MAX_SAFE_NAME - extension.length)
    .replace(/[. ]+$/, '');
  const base = stem === '' ? 'file' : stem;
  return DEVICE_NAME.test(base.split('.')[0] ?? '')
    ? `_${base}${extension}`
    : `${base}${extension}`;
}

export function evidenceTypeOf(filename: string): EvidenceType {
  const dot = filename.lastIndexOf('.');
  const extension = dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
  return TYPES[extension] ?? OPAQUE;
}

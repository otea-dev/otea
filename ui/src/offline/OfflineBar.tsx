import { useState } from 'react';
import { language, t } from '../i18n/i18n.ts';
import { Icon } from '../kit/Icon.tsx';
import type { SyncState } from './sync-state.ts';

// The line under the top bar while the PC does not answer: what is on screen is the last the app
// saw, read-only, and since when. Gone with the next answer from the PC.
//
// One word for it everywhere («Sin conexión», as the pill says); the cause follows it. On the desk
// it is one line with all of it. On the phone it is one quiet line, a dot, the word, the hour of the
// last sync and Reintentar, and a tap on it opens the cause and what still works: the conversation
// keeps the pane (field study 5: a card with the question, the wifi, the queue and a button took a
// third of a phone, and said the same as the pill, the assistant's line and the composer).

// The time of the last sync: its hour alone when it was today, with its day otherwise.
export function syncedTime(at: number, now: number, lang: string): string {
  const day = (ms: number) => new Date(ms).toDateString();
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const options: Intl.DateTimeFormatOptions =
    day(at) === day(now) ? time : { ...time, day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(lang, options).format(at);
}

// What the line says: always «Sin conexión»; then why. On this computer's own browser Otea itself is
// down. Anywhere else the app cannot reach the PC, and it asks the two things that cause it nearly
// every time: through Tailscale (a *.ts.net origin), whether Tailscale is connected on this phone,
// the everyday case of a phone set up once and left with Tailscale off; on the local network,
// whether it is on the same wifi; and, in both, whether Otea is open on the PC. `local`: nothing to
// check, it is this computer.
export type DownWords = { head: string; ask: string; local: boolean };

// `closed`: the PC's door answered with nothing behind it (sync-state.ts), so the phone does reach
// the PC and it is Otea that is not open there (TS-11).
export function downWords(host: string, phone = false, closed = false): DownWords {
  const head = t('offline.head');
  const name = host.toLowerCase();
  const local = !phone && (name === 'localhost' || name === '127.0.0.1' || name === '[::1]');
  if (local) return { head, ask: t('offline.askLocal'), local };
  if (closed) return { head, ask: t('offline.askClosed'), local };
  const tailscale = name === 'ts.net' || name.endsWith('.ts.net');
  return { head, ask: t(tailscale ? 'offline.askTailscale' : 'offline.askLan'), local };
}

export type OfflineBarProps = {
  sync: SyncState;
  now: number;
  host: string;
  phone?: boolean;
  // Nuevo still works: what is captured waits in the queue (offline/queue-store.ts).
  queues?: boolean;
  // Tries the PC again now: the live stream and every read.
  onRetry?: () => void;
};

export function OfflineBar({
  sync,
  now,
  host,
  phone = false,
  queues = false,
  onRetry,
}: OfflineBarProps) {
  const [open, setOpen] = useState(false);
  if (!sync.offline) return null;
  // Never synced: what shows is empty because nothing was saved, not because nothing waits (TS-5).
  const synced =
    sync.syncedAt === null
      ? t('offline.nothingSaved')
      : t('offline.synced', { time: syncedTime(sync.syncedAt, now, language()) });
  const words = downWords(host, phone, sync.closed === true);
  const readOnly = t(queues ? 'offline.readQueue' : 'offline.readOnly');
  const retry = onRetry ? (
    <button type="button" className="ob-retry" onClick={onRetry}>
      {t('offline.retry')}
    </button>
  ) : null;
  if (phone) {
    // The hour alone on the line («Sin conexión · 16:55»); the whole sentence is in the opened part.
    const hour =
      sync.syncedAt === null ? t('offline.noData') : syncedTime(sync.syncedAt, now, language());
    return (
      <div className="offline-bar" role="status" data-phone="" data-open={open || undefined}>
        <button
          type="button"
          className="ob-line"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="ob-dot" aria-hidden="true" />
          <span className="ob-text">
            <b>{words.head}</b>
            <span className="ob-when"> · {hour}</span>
          </span>
          <Icon name="chevron" />
        </button>
        {retry}
        <div className="ob-more" hidden={!open}>
          <p className="ob-ask">{words.ask}</p>
          <p className="ob-since">{synced}</p>
          <p className="ob-ro">{readOnly}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="offline-bar" role="status" data-ask={words.local ? undefined : ''}>
      <span className="ob-dot" aria-hidden="true" />
      <span className="ob-text">
        <b>{words.head}</b>
        <span className="ob-ask">. {words.ask}</span>
        <span className="ob-sep"> · </span>
        <span className="ob-when">{synced}</span>
      </span>
      <span className="ob-ro">{readOnly}</span>
      {retry}
    </div>
  );
}

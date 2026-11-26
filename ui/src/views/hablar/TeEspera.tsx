import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { waitedText } from '../../derive/when.ts';
import { language, t } from '../../i18n/i18n.ts';
import { Icon } from '../../kit/Icon.tsx';
import type { Pending, PendingEntry, PendingKind, QueueBlock } from '../../pending.ts';

// «Te espera»: everything that waits for you, pinned over the conversation, computed by Otea
// (GET /api/pending) and never by what the secretary remembers to say. A question that sat far up
// the thread, off screen on the phone, and a review that waited an hour and a half unmentioned are
// here from the moment they are yours. On the desk it is open; on the phone it is one line (what and
// how many) that opens with a tap. Each row goes where it is answered.

const GROUPS: readonly {
  kinds: readonly PendingKind[];
  key: 'q' | 'r' | 's' | 'x';
}[] = [
  { kinds: ['question', 'bandeja', 'secretary'], key: 'q' },
  { kinds: ['review'], key: 'r' },
  { kinds: ['step'], key: 's' },
  { kinds: ['stuck'], key: 'x' },
];

// «1 pregunta · 2 revisiones»: what waits, by kind.
export function summaryOf(entries: readonly PendingEntry[]): string {
  return GROUPS.flatMap(({ kinds, key }) => {
    const count = entries.filter((entry) => kinds.includes(entry.kind)).length;
    return count === 0 ? [] : [t(`hablar.te.sum.${key}`, { count })];
  }).join(' · ');
}

const list = (ids: readonly string[]): string =>
  new Intl.ListFormat(language(), { style: 'long', type: 'conjunction' }).format(ids);

// A review that holds the rest of a board's queue: said once, with what waits behind it.
export function blockText(block: QueueBlock): string {
  return t('hablar.te.block', {
    count: block.waiting.length,
    first: block.first,
    what: t(`hablar.te.what.${block.waitsFor}`),
    waiting: list(block.waiting),
  });
}

function Kind({ entry }: { entry: PendingEntry }) {
  const by = entry.by ?? '';
  return <span className="hb-te-k">{t(`hablar.te.k.${entry.kind}`, { agent: by })}</span>;
}

export type TeEsperaProps = {
  pending: Pending | undefined;
  // Goes to the Bandeja note (B-3) whose question waits.
  onNote: (ref: string) => void;
  // Goes to the turn of the secretary's question.
  onTurn: (root: number) => void;
};

export function TeEspera({ pending, onNote, onTurn }: TeEsperaProps) {
  const app = useApp();
  const [open, setOpen] = useState(!app.phone);
  if (!pending || (pending.count === 0 && pending.blocks.length === 0)) return null;
  const { entries, blocks } = pending;
  const go = (entry: PendingEntry) => {
    if (entry.kind === 'bandeja') onNote(entry.ref);
    else if (entry.kind === 'secretary' && entry.turn !== undefined) onTurn(entry.turn);
    else app.openItem(entry.ref);
  };
  return (
    <section className="hb-te" data-enter="fade" aria-label={t('hablar.te.title')}>
      <button
        type="button"
        className="hb-te-head"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="hb-te-n">{pending.count}</span>
        <span className="hb-te-title">{t('hablar.te.title')}</span>
        <span className="hb-te-sum">{summaryOf(entries)}</span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <ul className="hb-te-list">
          {blocks.map((block) => (
            <li key={`block:${block.first}`} className="hb-te-block">
              {blockText(block)}
            </li>
          ))}
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.ref}`}>
              <button
                type="button"
                className="hb-te-row"
                data-kind={entry.kind}
                onClick={() => go(entry)}
              >
                <span className="hb-te-ref">{entry.kind === 'secretary' ? '' : entry.ref}</span>
                <span className="hb-te-main">
                  <span className="hb-te-t">{entry.title}</span>
                  {entry.text !== undefined && entry.text !== entry.title ? (
                    <span className="hb-te-q">{entry.text}</span>
                  ) : null}
                </span>
                <Kind entry={entry} />
                <time className="hb-te-age" dateTime={entry.since ?? undefined}>
                  {waitedText(entry.since, app.now)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

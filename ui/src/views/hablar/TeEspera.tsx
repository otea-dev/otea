import { useState } from 'react';
import { postEscalationDismiss } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { waitedText } from '../../derive/when.ts';
import { language, t } from '../../i18n/i18n.ts';
import { Icon } from '../../kit/Icon.tsx';
import { toast } from '../../kit/index.ts';
import type { Pending, PendingEntry, PendingKind, QueueBlock } from '../../pending.ts';

// «Te espera»: everything that waits for you, pinned over the conversation, computed by Otea
// (GET /api/pending) and never by what the secretary remembers to say. It is an index, never a
// form: each row is one line that jumps to where the thing is dealt with (a question at the foot of
// the conversation, an item's page, a turn). A question that sat far up the thread and a review that
// waited an hour and a half unmentioned are here from the moment they are yours.
//
// Open when it holds something the conversation cannot answer (a review, a step of yours, a stuck
// item, a notice from an agent); closed to one line when it only holds questions, which the
// conversation's foot already shows with their buttons.

const GROUPS: readonly {
  kinds: readonly PendingKind[];
  key: 'q' | 'e' | 'r' | 's' | 'x';
}[] = [
  { kinds: ['question', 'bandeja', 'secretary'], key: 'q' },
  { kinds: ['escalation'], key: 'e' },
  { kinds: ['review'], key: 'r' },
  { kinds: ['step'], key: 's' },
  { kinds: ['stuck'], key: 'x' },
];

// What the conversation answers by itself: the questions. The rest is only here (and on Te toca).
const ANSWERED_BELOW: readonly PendingKind[] = ['question', 'bandeja', 'secretary'];

export const opensByDefault = (entries: readonly PendingEntry[]): boolean =>
  entries.some(({ kind }) => !ANSWERED_BELOW.includes(kind));

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

export type TeEsperaProps = {
  pending: Pending | undefined;
  // Goes to where the thing is dealt with.
  onJump: (entry: PendingEntry) => void;
};

export function TeEspera({ pending, onJump }: TeEsperaProps) {
  const app = useApp();
  // What the person chose by tapping the head; until then it opens as the content asks.
  const [chosen, setChosen] = useState<boolean | undefined>();
  if (!pending || (pending.count === 0 && pending.blocks.length === 0)) return null;
  const { entries, blocks } = pending;
  const open = chosen ?? opensByDefault(entries);
  return (
    <section className="hb-te" data-enter="fade" aria-label={t('hablar.te.title')}>
      <button
        type="button"
        className="hb-te-head"
        aria-expanded={open}
        onClick={() => setChosen(!open)}
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
            <li
              key={`${entry.kind}:${entry.ref}:${entry.signal ?? ''}`}
              data-dismissable={entry.signal === undefined ? undefined : ''}
            >
              <button
                type="button"
                className="hb-te-row"
                data-kind={entry.kind}
                onClick={() => onJump(entry)}
              >
                <span className="hb-te-ref">{entry.kind === 'secretary' ? '' : entry.ref}</span>
                <span className="hb-te-t">{entry.text ?? entry.title}</span>
                <span className="hb-te-k">
                  {t(`hablar.te.k.${entry.kind}`, { agent: entry.by ?? '' })}
                </span>
                <time className="hb-te-age" dateTime={entry.since ?? undefined}>
                  {waitedText(entry.since, app.now)}
                </time>
              </button>
              {entry.kind === 'escalation' && entry.signal !== undefined ? (
                <button
                  type="button"
                  className="hb-te-dismiss"
                  disabled={!app.session.canWrite}
                  onClick={() => {
                    postEscalationDismiss(entry.signal ?? 0).catch((error: unknown) =>
                      toast({ msg: error instanceof Error ? error.message : String(error) }),
                    );
                  }}
                >
                  {t('hablar.te.dismiss')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

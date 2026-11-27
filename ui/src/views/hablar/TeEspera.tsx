import { useCallback, useState } from 'react';
import { fetchRolePrompt, postEscalationDismiss } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { useCopy } from '../../components/AgentPrompt.tsx';
import { splitQuestion } from '../../conversation.ts';
import { waitedText } from '../../derive/when.ts';
import { useRemote } from '../../hooks.ts';
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
  key: 'q' | 'e' | 'r' | 's' | 'x' | 'w';
}[] = [
  { kinds: ['question', 'bandeja', 'secretary'], key: 'q' },
  { kinds: ['escalation'], key: 'e' },
  { kinds: ['review'], key: 'r' },
  { kinds: ['step'], key: 's' },
  { kinds: ['stuck'], key: 'x' },
  { kinds: ['worker'], key: 'w' },
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

// How many rows show before «Ver todas»: a long list never takes the room of the conversation
// (field study 4: eight reviews were half of the desk and 40% of the phone). On the phone the strip
// is one line beyond PHONE_ROWS rows, until the head is tapped.
export const SHOWN_ROWS = 3;
export const PHONE_ROWS = 2;

// What a row says: a question by the question itself, the rest by its text or its title.
export function rowText(entry: PendingEntry): string {
  if (entry.kind === 'worker') {
    return t('hablar.te.worker', { count: entry.items?.length ?? 1, board: entry.title });
  }
  if (entry.text !== undefined && ANSWERED_BELOW.includes(entry.kind)) {
    return splitQuestion(entry.text).lead;
  }
  return entry.text ?? entry.title;
}

// The worker's text for a board nobody works, to copy into a new session: read before the tap, so
// the copy is the tap's own.
function WorkerCopy({ board }: { board: string }) {
  const load = useCallback(
    (signal: AbortSignal) => fetchRolePrompt('worker', { board }, signal),
    [board],
  );
  const prompt = useRemote(load, useApp().version, 'live');
  const text = prompt.status === 'ready' ? prompt.value.prompt : '';
  const [copied, copy] = useCopy(text);
  return (
    <button type="button" className="hb-te-dismiss" disabled={text === ''} onClick={copy}>
      {copied ? t('hablar.te.worker.copied') : t('hablar.te.worker.copy')}
    </button>
  );
}

export function TeEspera({ pending, onJump }: TeEsperaProps) {
  const app = useApp();
  // What the person chose by tapping the head; until then it opens as the content asks.
  const [chosen, setChosen] = useState<boolean | undefined>();
  const [all, setAll] = useState(false);
  if (!pending || (pending.count === 0 && pending.blocks.length === 0)) return null;
  const { entries, blocks } = pending;
  const roomy = !app.phone || entries.length + blocks.length <= PHONE_ROWS;
  const open = chosen ?? (opensByDefault(entries) && roomy);
  const shown = all ? entries : entries.slice(0, SHOWN_ROWS);
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
          {shown.map((entry) => (
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
                <span className="hb-te-t">{rowText(entry)}</span>
                <span className="hb-te-k">
                  {t(`hablar.te.k.${entry.kind}`, { agent: entry.by ?? '' })}
                </span>
                <time className="hb-te-age" dateTime={entry.since ?? undefined}>
                  {waitedText(entry.since, app.now)}
                </time>
              </button>
              {entry.kind === 'worker' ? <WorkerCopy board={entry.ref} /> : null}
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
          {entries.length > SHOWN_ROWS ? (
            <li className="hb-te-foot">
              <button type="button" className="hb-te-more" onClick={() => setAll(!all)}>
                {all ? t('hablar.te.fewer') : t('hablar.te.all', { count: entries.length })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

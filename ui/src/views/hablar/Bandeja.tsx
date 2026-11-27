import { useCallback, useMemo, useState } from 'react';
import { bandejaFileUrl, fetchBandeja, postBandejaAnswer, postBandejaReopen } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { type BandejaEntry, entryTitle, isDone, ordered } from '../../bandeja.ts';
import { useRemote } from '../../hooks.ts';
import { t } from '../../i18n/i18n.ts';
import { isImage } from '../../intake-files.ts';
import { toast } from '../../kit/index.ts';
import { noteTime } from '../detail/notes.ts';
import { AskBody } from './Branch.tsx';

// The Bandeja, beside «Lo que salió»: what you captured as a rough note and where each note stands:
// waiting for the secretary, being refined by an agent, asking you something (with its options to
// tap, there), or filed as the item it became (a link to it). You look for what came out of what
// you said here, so it lives here and not in a list of its own; a question to you shows first.

// How many filed entries show before the rest are asked for.
const FILED_SHOWN = 3;

export function useBandeja(): { entries: BandejaEntry[] | undefined; reload: () => void } {
  const app = useApp();
  const [bump, setBump] = useState(0);
  const load = useCallback((signal: AbortSignal) => fetchBandeja(signal), []);
  const remote = useRemote(load, app.version + bump, app.connection);
  return {
    entries: remote.status === 'ready' ? remote.value.entries : undefined,
    reload: () => setBump((n) => n + 1),
  };
}

function Files({ entry }: { entry: BandejaEntry }) {
  if (entry.attachments.length === 0) return null;
  return (
    <ul className="bn-files" aria-label={t('bandeja.files', { count: entry.attachments.length })}>
      {entry.attachments.map((file) => (
        <li key={file.id}>
          <a href={bandejaFileUrl(file.id)} target="_blank" rel="noreferrer">
            {isImage(file.name) ? (
              <img src={bandejaFileUrl(file.id)} alt={file.name} loading="lazy" />
            ) : (
              <span className="bn-fname">{file.name}</span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

// A refiner's question on a note, with its options to tap, your own words, or the decision left to
// the refiner: in the Bandeja's row, and at the foot of the conversation, where it is seen.
export function BandejaAsk({ entry, onAnswered }: { entry: BandejaEntry; onAnswered: () => void }) {
  const asking = entry.asking;
  if (!asking) return null;
  return (
    <AskBody
      key={asking.question}
      by={asking.by}
      about={entry.ref}
      text={asking.text}
      options={asking.options ?? []}
      recommended={asking.recommended}
      send={async (given) => {
        await postBandejaAnswer(entry.id, { ...given, question: asking.question });
        toast({ msg: t('hablar.ask.sent') });
        onAnswered();
      }}
    />
  );
}

function Row({
  entry,
  now,
  onAnswered,
  lit,
  answerBelow,
}: {
  entry: BandejaEntry;
  now: number;
  onAnswered: () => void;
  lit: boolean;
  answerBelow: boolean;
}) {
  const app = useApp();
  // A second tap while the first is on its way is the same tap.
  const [reopening, setReopening] = useState(false);
  const asking = entry.asking;
  const known = entry.item !== null && app.all.some(({ id }) => id === entry.item);
  const state = t(`bandeja.st.${entry.state}`, {
    agent: entry.claimedBy ?? '',
    item: entry.item ?? '',
    reason: entry.closeReason ?? '',
  });
  return (
    <li
      className="bn-row"
      id={`bn-${entry.ref}`}
      data-state={entry.state}
      data-lit={lit || undefined}
    >
      <div className="bn-meta">
        <span className="bn-ref">{entry.ref}</span>
        <time dateTime={entry.at}>{noteTime(entry.at, now)}</time>
        {entry.state === 'filed' && entry.item !== null && known ? (
          <button
            type="button"
            className="bn-st bn-link"
            data-state="filed"
            onClick={() => app.openItem(entry.item ?? '')}
          >
            {state}
          </button>
        ) : (
          <span className="bn-st" data-state={entry.state}>
            {state}
          </span>
        )}
      </div>
      <p className="bn-title">{entryTitle(entry) || t('bandeja.onlyFiles')}</p>
      <Files entry={entry} />
      {entry.state === 'closed' ? (
        <button
          type="button"
          className="bn-reopen"
          disabled={!app.session.canWrite || reopening}
          onClick={() => {
            if (reopening) return;
            setReopening(true);
            postBandejaReopen(entry.id)
              .then(onAnswered)
              .catch((error: unknown) =>
                toast({ msg: error instanceof Error ? error.message : String(error) }),
              )
              .finally(() => setReopening(false));
          }}
        >
          {t('bandeja.reopen')}
        </button>
      ) : null}
      {asking ? (
        answerBelow ? (
          <p className="bn-below">{t('bandeja.below')}</p>
        ) : (
          <BandejaAsk entry={entry} onAnswered={onAnswered} />
        )
      ) : null}
    </li>
  );
}

export type BandejaProps = {
  // Undefined while they are being read.
  entries: BandejaEntry[] | undefined;
  reload: () => void;
  // The note a link opened at (B-3): it lights for a moment.
  lit?: string | undefined;
  // The conversation shows its foot, where a question is answered: the list only says where the
  // question stands, so a question never has two forms.
  answerBelow?: boolean | undefined;
};

export function Bandeja({ entries, reload, lit, answerBelow = false }: BandejaProps) {
  const app = useApp();
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => ordered(entries ?? []), [entries]);
  const open = sorted.filter((entry) => !isDone(entry));
  const filed = sorted.filter(isDone);
  const shown = all ? filed : filed.slice(0, FILED_SHOWN);
  if (entries === undefined || sorted.length === 0) return null;
  return (
    <section className="bn-box" aria-label={t('bandeja.title')}>
      <h3 className="bn-h">
        {t('bandeja.title')}
        <small>{open.length}</small>
      </h3>
      <p className="bn-dek">{t('bandeja.dek')}</p>
      <ul className="bn-list">
        {[...open, ...shown].map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            now={app.now}
            onAnswered={reload}
            lit={lit === entry.ref}
            answerBelow={answerBelow}
          />
        ))}
      </ul>
      {filed.length > FILED_SHOWN ? (
        <button type="button" className="bn-more" onClick={() => setAll((on) => !on)}>
          {all ? t('bandeja.fewer') : t('bandeja.more', { count: filed.length - FILED_SHOWN })}
        </button>
      ) : null}
    </section>
  );
}

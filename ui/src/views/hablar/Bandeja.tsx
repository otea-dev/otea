import { useCallback, useMemo, useState } from 'react';
import { bandejaFileUrl, fetchBandeja, postBandejaAnswer } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { type BandejaEntry, entryTitle, ordered } from '../../bandeja.ts';
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

function Row({
  entry,
  now,
  onAnswered,
}: {
  entry: BandejaEntry;
  now: number;
  onAnswered: () => void;
}) {
  const app = useApp();
  const asking = entry.asking;
  const known = entry.item !== null && app.all.some(({ id }) => id === entry.item);
  const state = t(`bandeja.st.${entry.state}`, {
    agent: entry.claimedBy ?? '',
    item: entry.item ?? '',
  });
  return (
    <li className="bn-row" data-state={entry.state}>
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
      {asking ? (
        <AskBody
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
      ) : null}
    </li>
  );
}

export function Bandeja() {
  const app = useApp();
  const { entries, reload } = useBandeja();
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => ordered(entries ?? []), [entries]);
  const open = sorted.filter(({ state }) => state !== 'filed');
  const filed = sorted.filter(({ state }) => state === 'filed');
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
          <Row key={entry.id} entry={entry} now={app.now} onAnswered={reload} />
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

import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { postCapture } from '../api.ts';
import { useApp } from '../app/context.tsx';
import { t } from '../i18n/i18n.ts';
import {
  type FileDraft,
  MAX_FILE_MB,
  MAX_FILES,
  sizeLabel,
  tooLarge,
  withFiles,
} from '../intake-files.ts';
import { Icon } from '../kit/index.ts';
import { Thumb } from './IntakeFiles.tsx';

// The quick capture, free text (Nuevo ítem, «Nota rápida»): what you want written down, and files
// (pictures, screenshots, documents) with the limits an item's files have. No board, no form: it
// lands in the project's Bandeja, where the secretary has it refined into an item and asks you what
// is missing. The send carries an Idempotency-Key kept until it lands, so a phone that never heard
// back sends it again and it is one entry. What was typed stays when the send fails.

function newKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}

let seq = 0;
const draftKey = () => `bn-file-${++seq}`;

export function NoteCapture({
  onSent,
  autoFocus = false,
  hint,
}: {
  // It landed in the Bandeja.
  onSent: () => void;
  autoFocus?: boolean;
  hint?: string | undefined;
}) {
  const app = useApp();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<FileDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The key of the send in flight or the last one that failed: the same words and files send again
  // under it; any change makes a new send.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const canWrite = app.session.canWrite;
  const words = text.trim();
  const large = drafts.find(({ file }) => tooLarge(file));
  const ready = (words !== '' || drafts.length > 0) && !large && canWrite && !busy;

  const add = (files: File[]) => {
    if (files.length === 0) return;
    setDrafts((was) => withFiles(was, files, 'single', draftKey));
  };

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    const sig = JSON.stringify([
      words,
      drafts.map(({ file }) => [file.name, file.size, file.lastModified]),
    ]);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: newKey() };
    const { key } = attempt.current;
    setBusy(true);
    setError(null);
    postCapture({ text: words, files: drafts.map(({ file }) => file) }, key).then(
      () => {
        attempt.current = null;
        if (!alive.current) return;
        setText('');
        setDrafts([]);
        setBusy(false);
        onSent();
      },
      (failure: unknown) => {
        if (!alive.current) return;
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };

  const onPaste = (event: ClipboardEvent<HTMLFormElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  };

  return (
    <form className="bn-note" aria-label={t('bandeja.note')} onSubmit={send} onPaste={onPaste}>
      {hint ? <p className="bn-hint">{hint}</p> : null}
      <textarea
        ref={field}
        className="bn-text"
        rows={4}
        value={text}
        disabled={!canWrite}
        aria-label={t('bandeja.note')}
        placeholder={t('bandeja.placeholder')}
        enterKeyHint="enter"
        onChange={(event) => setText(event.target.value)}
      />
      {drafts.length > 0 ? (
        <ul className="hb-drafts">
          {drafts.map(({ key, file }) => (
            <li key={key} data-error={tooLarge(file) || undefined}>
              <Thumb file={file} />
              <span className="hb-dname">
                <span>{file.name}</span>
                <small>
                  {tooLarge(file) ? t('hablar.tooBig', { mb: MAX_FILE_MB }) : sizeLabel(file.size)}
                </small>
              </span>
              <button
                type="button"
                className="hb-dx"
                aria-label={t('hablar.remove', { name: file.name })}
                onClick={() => setDrafts((was) => was.filter((each) => each.key !== key))}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="bn-acts">
        <button
          type="button"
          className="bn-attach"
          aria-label={t('hablar.attach')}
          disabled={!canWrite || drafts.length >= MAX_FILES}
          onClick={() => picker.current?.click()}
        >
          <Icon name="attach" />
          <span>{t('bandeja.attach')}</span>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label={t('hablar.attach')}
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <button type="submit" className="btn primary bn-save" disabled={!ready} aria-busy={busy}>
          {busy ? t('bandeja.saving') : t('bandeja.save')}
        </button>
      </div>
      {error !== null ? (
        <p className="bn-err" role="alert">
          {t('bandeja.failed', { message: error })}
        </p>
      ) : !canWrite ? (
        <p className="bn-hint" role="status">
          {t('hablar.readOnly')}
        </p>
      ) : (
        <p className="bn-hint">{t('bandeja.lands')}</p>
      )}
    </form>
  );
}

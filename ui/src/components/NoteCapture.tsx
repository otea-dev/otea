import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { postCapture, Unheard } from '../api.ts';
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
import { clearNoteDraft, keepNoteDraft, readNoteDraft } from '../note-draft.ts';
import { QUEUE_MAX_MB } from '../offline/capture-queue.ts';
import { enqueue, type Queued, queueAvailable } from '../offline/queue-store.ts';
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
  // It landed in the Bandeja (under `ref`, B-3), or waits on this device for the PC to answer
  // (queued: no entry yet).
  onSent: (how: 'sent' | 'queued', ref?: string) => void;
  autoFocus?: boolean;
  hint?: string | undefined;
}) {
  const app = useApp();
  const project = app.project?.id;
  // The words a send that failed left behind come back, a reload too.
  const [text, setText] = useState(() => readNoteDraft(project) ?? '');
  const [drafts, setDrafts] = useState<FileDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The key of the send in flight or the last one that failed: the same words and files send again
  // under it; any change makes a new send.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const alive = useRef(true);
  // Set on every mount: StrictMode runs the effect, its cleanup and the effect again, and the ref
  // must say the page is alive after that.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    const sig = JSON.stringify([
      words,
      drafts.map(({ file }) => [file.name, file.size, file.lastModified]),
    ]);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: newKey() };
    const { key } = attempt.current;
    const files = drafts.map(({ file }) => file);
    setBusy(true);
    setError(null);
    // It is over: the box is empty, and the words kept for a failed send are no longer needed.
    const done = (how: 'sent' | 'queued', ref?: string) => {
      attempt.current = null;
      clearNoteDraft(project);
      if (!alive.current) return;
      setText('');
      setDrafts([]);
      setBusy(false);
      if (ref === undefined) onSent(how);
      else onSent(how, ref);
    };
    // What goes wrong is said here, with the words kept (and on the phone for a reload): never a
    // button left busy with no word.
    const fail = (message: string) => {
      keepNoteDraft(project, words);
      if (!alive.current) return;
      setBusy(false);
      setError(message);
    };
    // The PC does not answer: the note waits on the phone, files included, and goes when it does.
    const keep = async () => {
      let kept: Queued;
      try {
        kept = await enqueue({
          id: key,
          at: Date.now(),
          ...(project ? { project } : {}),
          board: '',
          type: '',
          fields: {},
          note: {
            text: words,
            files: await Promise.all(
              files.map(async (file) => ({
                name: file.name,
                type: file.type,
                bytes: await file.arrayBuffer(),
              })),
            ),
          },
        });
      } catch {
        return fail(t('phone.capture.unreadable'));
      }
      if (!kept.ok) {
        return fail(
          kept.reason === 'full' ? t('offline.full', { mb: QUEUE_MAX_MB }) : t('offline.storage'),
        );
      }
      done('queued');
    };
    try {
      if (app.sync.offline && queueAvailable()) return await keep();
      const entry = await postCapture({ text: words, files }, key);
      done('sent', entry.ref);
    } catch (failure) {
      if (failure instanceof Unheard && queueAvailable()) return keep();
      fail(failure instanceof Error ? failure.message : String(failure));
    }
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
        <p className="bn-hint">
          {app.sync.offline && queueAvailable() ? t('bandeja.queues') : t('bandeja.lands')}
        </p>
      )}
    </form>
  );
}

import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { postCapture, Unheard } from '../api.ts';
import { useApp } from '../app/context.tsx';
import { t } from '../i18n/i18n.ts';
import {
  type FileDraft,
  MAX_FILE_MB,
  MAX_FILES,
  shownFileName,
  sizeLabel,
  tooLarge,
  withFiles,
} from '../intake-files.ts';
import { Icon, toast } from '../kit/index.ts';
import { clearNoteDraft, keepNoteDraft, readNoteDraft } from '../note-draft.ts';
import { keepNoteFiles, readNoteFiles } from '../note-draft-files.ts';
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
  // Words a send left behind (or that came back from one): they can be thrown away.
  const [kept, setKept] = useState(() => readNoteDraft(project) !== undefined);
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

  // The note is kept as it is written, words and files, so the page reloading under it (the
  // installed app updating itself while the camera, another app, has the front) loses nothing: it
  // comes back as it was. A send that lands, or Descartar, empties it.
  useEffect(() => {
    if (text.trim() === '') clearNoteDraft(project);
    else keepNoteDraft(project, text);
  }, [text, project]);
  // Files are put back once, before any is kept: until then an empty box must not wipe them.
  const filesRead = useRef(false);
  useEffect(() => {
    let current = true;
    void readNoteFiles(project).then((files) => {
      if (!current) return;
      filesRead.current = true;
      if (files.length > 0)
        setDrafts((was) => (was.length > 0 ? was : withFiles([], files, 'single', draftKey)));
    });
    return () => {
      current = false;
    };
  }, [project]);
  useEffect(() => {
    if (filesRead.current)
      void keepNoteFiles(
        project,
        drafts.map(({ file }) => file),
      );
  }, [drafts, project]);

  // Online as the session allows; while the computer does not answer the session reads read-only,
  // and a note still goes to the queue (app.canCapture).
  const canWrite = app.canCapture;
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
      void keepNoteFiles(project, []);
      if (!alive.current) return;
      setText('');
      setKept(false);
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
      setKept(words !== '');
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

  // Throws away what a send that failed left: the words, the files, the error, and the copy kept
  // on this phone.
  // A tap that wipes words and pictures is a tap that can be taken back: Deshacer puts them as they
  // were (and the box keeps them again, as it keeps anything written).
  const discard = () => {
    const was = { text, drafts, kept };
    attempt.current = null;
    clearNoteDraft(project);
    void keepNoteFiles(project, []);
    setText('');
    setKept(false);
    setDrafts([]);
    setError(null);
    field.current?.focus({ preventScroll: true });
    if (was.text.trim() === '' && was.drafts.length === 0) return;
    toast({
      msg: t('bandeja.discarded'),
      undo: () => {
        if (!alive.current) {
          // The sheet was closed meanwhile: the note waits in the box's keeping for the next time.
          keepNoteDraft(project, was.text);
          void keepNoteFiles(
            project,
            was.drafts.map(({ file }) => file),
          );
          return;
        }
        setText(was.text);
        setDrafts(was.drafts);
        setKept(was.kept);
        field.current?.focus({ preventScroll: true });
      },
    });
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
        placeholder={t(
          app.pending?.secretary === null ? 'bandeja.placeholderAlone' : 'bandeja.placeholder',
        )}
        enterKeyHint="enter"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Ctrl+Enter (Cmd+Enter) sends; Enter stays a new line.
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          void send();
        }}
      />
      {drafts.length > 0 ? (
        <ul className="hb-drafts">
          {drafts.map(({ key, file }) => (
            <li key={key} data-error={tooLarge(file) || undefined}>
              <Thumb file={file} />
              <span className="hb-dname">
                <span>{shownFileName(file.name, file.lastModified)}</span>
                <small>
                  {tooLarge(file) ? t('hablar.tooBig', { mb: MAX_FILE_MB }) : sizeLabel(file.size)}
                </small>
              </span>
              <button
                type="button"
                className="hb-dx"
                aria-label={t('hablar.remove', {
                  name: shownFileName(file.name, file.lastModified),
                })}
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
        {kept && !busy ? (
          <button type="button" className="bn-discard" onClick={discard}>
            {t('bandeja.discard')}
          </button>
        ) : null}
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
          {app.sync.offline && queueAvailable()
            ? t('bandeja.queues')
            : app.pending?.secretary === null
              ? t('bandeja.landsAlone')
              : t('bandeja.lands')}
        </p>
      )}
    </form>
  );
}

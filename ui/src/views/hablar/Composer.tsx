import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { postMessage } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { Thumb } from '../../components/IntakeFiles.tsx';
import { SUGGESTIONS } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import {
  type FileDraft,
  MAX_FILE_MB,
  MAX_FILES,
  shownFileName,
  sizeLabel,
  tooLarge,
  withFiles,
} from '../../intake-files.ts';
import { Icon } from '../../kit/index.ts';
import { useClearAbove } from './clear-above.ts';

// Where you write to your secretary: the words, files to attach (picked, pasted or dropped, the
// way a new item takes them), three suggestions to start from, and Enviar. Dictation is the
// keyboard's own. The send carries an Idempotency-Key kept until it lands, so a send that was
// repeated (a phone that never heard back) is one message.

const MAX_HEIGHT = 168;

function newKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}

let seq = 0;
const draftKey = () => `hb-file-${++seq}`;

export function Composer({ onSent }: { onSent: () => void }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<FileDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLFieldSetElement>(null);
  useClearAbove(box);
  // The key of the send in flight or the last one that failed: the same words and files send again
  // under it; any change makes a new send.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const offline = app.sync.offline;
  const canWrite = app.session.canWrite;
  const large = drafts.find(({ file }) => tooLarge(file));
  const words = text.trim();
  const ready = (words !== '' || drafts.length > 0) && !large && !offline && canWrite && !busy;

  // The box grows with what is written, up to a few lines, then scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures after the text changes
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const add = (files: File[]) => {
    if (files.length === 0) return;
    setDrafts((was) => withFiles(was, files, 'single', draftKey));
  };

  const send = () => {
    if (!ready) return;
    const sig = JSON.stringify([
      words,
      drafts.map(({ file }) => [file.name, file.size, file.lastModified]),
    ]);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: newKey() };
    const { key } = attempt.current;
    const sentText = text;
    const sentKeys = new Set(drafts.map((draft) => draft.key));
    setBusy(true);
    setError(null);
    postMessage({ text: words, files: drafts.map(({ file }) => file) }, key).then(
      () => {
        attempt.current = null;
        // Only what was sent goes: words or files added while it was on its way stay, and are
        // the next send, under a key of their own.
        setText((now) => (now === sentText ? '' : now));
        setDrafts((now) => now.filter((draft) => !sentKeys.has(draft.key)));
        setBusy(false);
        onSent();
        field.current?.focus();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An Enter that confirms an IME candidate is not a send: Safari ends the composition before
    // the key arrives, and marks it with keyCode 229.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    // The phone's Enter is a new line (Enviar is its button); the desk's sends, Shift+Enter breaks.
    if (app.phone || event.shiftKey) return;
    event.preventDefault();
    send();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  };

  return (
    <fieldset
      ref={box}
      className="hb-composer"
      aria-label={t('hablar.composer')}
      data-over={over || undefined}
      onDragOver={(event) => {
        if (!canWrite) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (canWrite) add([...event.dataTransfer.files]);
      }}
    >
      <ul className="hb-suggs" aria-label={t('hablar.suggestions')}>
        {SUGGESTIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              className="hb-sugg"
              disabled={!canWrite}
              onClick={() => {
                // Added to what you were writing, never over it.
                setText((was) => (was.trim() === '' ? t(key) : `${was.trimEnd()} ${t(key)}`));
                field.current?.focus();
              }}
            >
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
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
      <div className="hb-input">
        <button
          type="button"
          className="hb-attach"
          aria-label={t('hablar.attach')}
          data-tip={app.phone ? undefined : t('hablar.attach')}
          disabled={!canWrite || drafts.length >= MAX_FILES}
          onClick={() => picker.current?.click()}
        >
          <Icon name="attach" />
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
        <textarea
          ref={field}
          rows={1}
          value={text}
          disabled={!canWrite}
          aria-label={t('hablar.composer')}
          placeholder={t(app.phone ? 'hablar.placeholderShort' : 'hablar.placeholder')}
          enterKeyHint={app.phone ? 'enter' : 'send'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button
          type="button"
          className="hb-send"
          disabled={!ready}
          aria-label={t('hablar.send')}
          onClick={send}
        >
          <span className="lb">{busy ? t('hablar.sending') : t('hablar.send')}</span>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {error !== null ? (
        <p className="hb-err" role="alert">
          {t('hablar.failed', { message: error })}
        </p>
      ) : offline ? (
        <p className="hb-note hb-note-off" role="status">
          {t('hablar.offline')}
        </p>
      ) : !canWrite ? (
        <p className="hb-note" role="status">
          {t('hablar.readOnly')}
        </p>
      ) : null}
    </fieldset>
  );
}

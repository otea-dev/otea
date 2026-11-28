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
import { toast } from '../../kit/pop/toast.tsx';
import { useClearAbove } from './clear-above.ts';

// Where you write to your assistant: the words, files to attach (picked, pasted or dropped, the
// way a new item takes them), three suggestions to start from, and Enviar. Dictation is the
// keyboard's own. The send carries an Idempotency-Key kept until it lands, so a send that was
// repeated (a phone that never heard back) is one message.

const MAX_HEIGHT = 168;
// A suggestion tapped again inside this is the same tap.
const CHIP_AGAIN_MS = 700;

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
  const lastChip = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  useClearAbove(box);
  // The key of the send in flight or the last one that failed: the same words and files send again
  // under it; any change makes a new send.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const offline = app.sync.offline;
  const canWrite = app.session.canWrite;
  const large = drafts.find(({ file }) => tooLarge(file));
  const words = text.trim();
  const ready = (words !== '' || drafts.length > 0) && !large && !offline && canWrite && !busy;

  // The line that says the send failed sits under the box, which a small or zoomed window keeps
  // below its fold: out of sight, it is said over the page too. In sight, once is enough (D-0607d1).
  const failure = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error === null) return;
    const line = failure.current?.getBoundingClientRect();
    if (line && (line.top < 0 || line.bottom > window.innerHeight))
      toast({ msg: t('hablar.failed', { message: error }) });
  }, [error]);

  // The box grows with what is written, up to a few lines, then scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures after the text changes
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    // It scrolls only once it has reached its tallest: a box that fits its words draws no scroll
    // bar (a phone drew a grey bar between the words and Enviar when the line was a pixel taller
    // than the box).
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  // A phone, or a screen the finger is the pointer of (a tablet): the keyboard comes up on the field.
  const touch = () =>
    app.phone ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches === true);

  const add = (files: File[]) => {
    if (files.length === 0) return;
    setDrafts((was) => withFiles(was, files, 'single', draftKey));
  };

  // «/» takes the person to the box from anywhere on the page that is no box of its own (D-7bb68e):
  // the thread above it has links and cards, and the way there by Tab was twenty stops.
  useEffect(() => {
    const press = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const on = e.target;
      if (
        on instanceof HTMLElement &&
        (on.isContentEditable || on.matches('input, textarea, select'))
      )
        return;
      const el = field.current;
      if (!el || el.disabled) return;
      e.preventDefault();
      el.focus();
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, []);

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
        // On the desk the next message is typed at once. On a touch device the keyboard that
        // stayed up covered the nav and the composer: it goes away, and a tap on the field brings
        // it back.
        if (touch()) field.current?.blur();
        else field.current?.focus();
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
    // A key that is refused says so: the line under the box can be below the window's fold, and a
    // lost key reads as a lost message (D-0607d1). The words stay where they are.
    if (offline && canWrite && (words !== '' || drafts.length > 0)) {
      toast({ msg: t('hablar.notSent') });
      return;
    }
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
      data-offline={offline || undefined}
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
        <li>
          <button
            type="button"
            className="hb-jot"
            disabled={!canWrite}
            onClick={() => app.newItem()}
          >
            <Icon name="note" />
            {t('nav.jot')}
          </button>
        </li>
        {SUGGESTIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              className="hb-sugg"
              disabled={!canWrite}
              onClick={() => {
                // A double tap (a finger that lands twice) is one tap: the same chip again within
                // a moment adds nothing (D-d251b3).
                const now = Date.now();
                if (lastChip.current.key === key && now - lastChip.current.at < CHIP_AGAIN_MS)
                  return;
                lastChip.current = { key, at: now };
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
            // The dialog gave the focus back to nothing: the box, where the words go next (on a
            // touch device it would raise the keyboard).
            if (!touch()) field.current?.focus();
          }}
        />
        <textarea
          ref={field}
          rows={1}
          value={text}
          disabled={!canWrite}
          aria-label={t('hablar.composer')}
          // Without the PC nothing can be written here (a message is never queued: Hablar's talk
          // waits for the PC; what is captured in Nuevo is what queues). On the phone the field
          // says so itself.
          placeholder={t(
            app.phone
              ? offline
                ? 'hablar.placeholderOffline'
                : 'hablar.placeholderShort'
              : 'hablar.placeholder',
          )}
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
        <p ref={failure} className="hb-err" role="alert">
          {t('hablar.failed', { message: error })}
        </p>
      ) : offline ? (
        // The phone says it in the field's own words and the line over the page: a note under it
        // would be a third «sin conexión».
        app.phone ? null : (
          <p className="hb-note hb-note-off" role="status">
            {t('hablar.offline')}
          </p>
        )
      ) : !canWrite ? (
        <p className="hb-note" role="status">
          {t('hablar.readOnly')}
        </p>
      ) : null}
    </fieldset>
  );
}

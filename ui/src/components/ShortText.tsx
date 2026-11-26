import { useId, useState } from 'react';
import { FOLD_CHARS, FOLD_LINES, splitReply } from '../conversation.ts';
import { t } from '../i18n/i18n.ts';
import { NoteText } from './NoteText.tsx';

// What an agent wrote for the person (a question, a handoff note) set as the secretary's replies
// are: the conclusion in one sentence, the rest in body text, and a rest that runs long folded
// behind «ver más» (field study 3: both were walls of text on the phone, with paths and commands).
// The folded rest is not in the page until it is opened.
//
// A Markdown text that opens with a list, a table, a heading or code has no sentence to lead with:
// it is shown from its start, cut to a few lines while it is long.
const STRUCTURED = /^\s*(?:[#>|`]|[-*+]\s|\d+[.)]\s)/;

export function ShortText({
  text,
  markdown = false,
  leadClass,
}: {
  text: string;
  // The text is Markdown (a note): its lists and code are drawn; a question is plain words.
  markdown?: boolean;
  // The class of the conclusion, the surface's own voice.
  leadClass: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = (shown: boolean) => (
    <button
      type="button"
      className="st-toggle"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setOpen(!open)}
    >
      {shown ? t('hablar.less') : t('hablar.more')}
    </button>
  );
  if (markdown && STRUCTURED.test(text)) {
    const long =
      text.length > FOLD_CHARS * 2 ||
      text.split(/\r?\n/).filter((line) => line.trim() !== '').length > FOLD_LINES * 3;
    return (
      <>
        <div id={id} className={long && !open ? 'st-clamp' : undefined}>
          <NoteText text={text} className={leadClass} />
        </div>
        {long ? toggle(open) : null}
      </>
    );
  }
  const reply = splitReply(text);
  const draw = (words: string, className: string) =>
    markdown ? (
      <NoteText text={words} className={className} />
    ) : (
      <p className={className}>{words}</p>
    );
  const showRest = reply.rest !== '' && (!reply.folds || open);
  return (
    <>
      {reply.lead === '' ? null : draw(reply.lead, leadClass)}
      {showRest ? (
        <div id={id} className="st-rest">
          {draw(reply.rest, 'st-body')}
        </div>
      ) : null}
      {reply.folds ? toggle(open) : null}
    </>
  );
}

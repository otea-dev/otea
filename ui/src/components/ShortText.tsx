import { useId, useState } from 'react';
import { FOLD_CHARS, FOLD_LINES, splitQuestion, splitReply } from '../conversation.ts';
import { t } from '../i18n/i18n.ts';
import { NoteText } from './NoteText.tsx';
import { Ticked } from './Ticked.tsx';

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
  question = false,
}: {
  text: string;
  // The text is a question to you: its question leads, whatever sentence comes first, and what
  // folds is its context (a card's buttons answer it, so it is read before them).
  question?: boolean;
  // The text is Markdown (a note): its lists and code are drawn; a question is plain words.
  markdown?: boolean;
  // The class of the conclusion, the surface's own voice.
  leadClass: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // `target`: what the toggle opens is on the page now (a folded rest is not, so nothing is named).
  const toggle = (shown: boolean, target: boolean) => (
    <button
      type="button"
      className="st-toggle"
      aria-expanded={open}
      aria-controls={target ? id : undefined}
      onClick={() => setOpen(!open)}
    >
      {shown ? t('hablar.less') : t('hablar.more')}
    </button>
  );
  if (STRUCTURED.test(text)) {
    const long =
      text.length > FOLD_CHARS * 2 ||
      text.split(/\r?\n/).filter((line) => line.trim() !== '').length > FOLD_LINES * 3;
    return (
      <>
        <div id={id} className={long && !open ? 'st-clamp' : undefined}>
          {markdown ? (
            <NoteText text={text} className={leadClass} />
          ) : (
            <p className={`${leadClass} st-lines`}>
              <Ticked text={text} />
            </p>
          )}
        </div>
        {long ? toggle(open, true) : null}
      </>
    );
  }
  const reply = question ? splitQuestion(text) : splitReply(text);
  const draw = (words: string, className: string) =>
    markdown ? (
      <NoteText text={words} className={className} />
    ) : (
      <p className={className}>
        <Ticked text={words} />
      </p>
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
      {reply.folds ? toggle(open, showRest) : null}
    </>
  );
}

import { Fragment } from 'react';
import { codeSpans } from '../conversation.ts';

// Words an agent wrote with `code` between backticks, drawn with the code as code (a small mono chip,
// `.tick` in base.css) and no marks around it: a question's lines, its options, the line saying what
// you answered, a row's quote of what an agent delivered. A backtick with no mate stays a backtick.
// Inline only (no links, no markup), so it fits inside a button. A cut preview (a snippet, a card's
// title) leaves the marks out instead (conversation.ts quotedSnippet).
export function Ticked({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((span, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the spans of a text never move
        <Fragment key={index}>
          {span.code ? <code className="tick">{span.text}</code> : span.text}
        </Fragment>
      ))}
    </>
  );
}

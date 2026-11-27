import { Fragment } from 'react';
import { codeSpans } from '../conversation.ts';

// Words an agent wrote with `code` between backticks, drawn with the code as code and no marks
// around it: a question's lines, its options and the line saying what you answered. A backtick with
// no mate stays a backtick. Inline only (no links, no markup), so it fits inside a button.
export function Ticked({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((span, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the spans of a text never move
        <Fragment key={index}>{span.code ? <code>{span.text}</code> : span.text}</Fragment>
      ))}
    </>
  );
}

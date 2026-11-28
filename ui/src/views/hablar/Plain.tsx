import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { codeSpans, type Glued, gluePunctuation, piecesOf } from '../../conversation.ts';

type Node = Glued | { kind: 'code'; text: string };

// A message's words as they were written: plain text, its line breaks kept. An id of an item of
// this project opens the item; a web address opens in a new tab; what stands between backticks is
// code. The marks around a link hold to it, so a line never breaks inside «(CAM-1),». Nothing else
// is read as markup.
export function Plain({ text, className }: { text: string; className?: string }) {
  const app = useApp();
  const known = useMemo(() => new Set(app.all.map((item) => item.id)), [app.all]);
  const nodes = useMemo(
    () =>
      codeSpans(text).flatMap((span): Node[] =>
        span.code
          ? [{ kind: 'code', text: span.text }]
          : gluePunctuation(piecesOf(span.text, known)),
      ),
    [text, known],
  );
  return (
    <span className={className ? `hb-plain ${className}` : 'hb-plain'}>
      {nodes.map((node, index) => {
        const key = `${index}:${node.kind}`;
        if (node.kind === 'text') return <span key={key}>{node.text}</span>;
        if (node.kind === 'code') return <code key={key}>{node.text}</code>;
        if (node.kind === 'url') {
          return (
            <a key={key} href={node.url} target="_blank" rel="noreferrer noopener">
              {node.url}
            </a>
          );
        }
        return (
          <span key={key} className="hb-glue">
            {node.open}
            <button type="button" className="hb-ref" onClick={() => app.openItem(node.id)}>
              {node.id}
            </button>
            {node.close}
          </span>
        );
      })}
    </span>
  );
}

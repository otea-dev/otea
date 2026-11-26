import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { piecesOf } from '../../conversation.ts';

// A message's words as they were written: plain text, its line breaks kept. An id of an item of
// this project opens the item; a web address opens in a new tab. Nothing else is read as markup.
export function Plain({ text, className }: { text: string; className?: string }) {
  const app = useApp();
  const known = useMemo(() => new Set(app.all.map((item) => item.id)), [app.all]);
  const pieces = useMemo(() => piecesOf(text, known), [text, known]);
  return (
    <span className={className ? `hb-plain ${className}` : 'hb-plain'}>
      {pieces.map((piece, index) => {
        const key = `${index}:${piece.kind}`;
        if (piece.kind === 'text') return <span key={key}>{piece.text}</span>;
        if (piece.kind === 'url') {
          return (
            <a key={key} href={piece.url} target="_blank" rel="noreferrer noopener">
              {piece.url}
            </a>
          );
        }
        return (
          <button key={key} type="button" className="hb-ref" onClick={() => app.openItem(piece.id)}>
            {piece.id}
          </button>
        );
      })}
    </span>
  );
}

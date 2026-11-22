import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../markdown.ts';
import { markdown } from '../modules/markdown.tsx';
import { NoteText } from './NoteText.tsx';

describe('NoteText', () => {
  it('draws a note’s Markdown, tables included, and escapes raw HTML', () => {
    const html = renderToStaticMarkup(
      <NoteText
        className="p-text"
        text={'- **a**\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n<b>no</b>'}
      />,
    );
    expect(html).toContain('<div class="md note-md p-text">');
    expect(html).toContain('<strong>a</strong>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<b>no</b>');
  });

  // One link to a line ran together into «url url url» when a single newline read as a space; a hard
  // break (two spaces) must not turn into a second, blank line.
  const brs = (html: string) => (html.match(/<br ?\/?>/g) ?? []).length;

  it.each([
    ['a note', {}],
    ['the phone’s note', { className: 'p-text' }],
  ])(
    'keeps a single newline as one line break in %s, and a hard break as one, not two',
    (_, cls) => {
      const single = renderToStaticMarkup(<NoteText {...cls} text={'a\nhttps://x.dev/1\nb'} />);
      expect(brs(single)).toBe(2);
      const hard = renderToStaticMarkup(<NoteText {...cls} text={'a  \nb'} />);
      expect(brs(hard)).toBe(1);
      const back = renderToStaticMarkup(<NoteText {...cls} text={'a\\\nb'} />);
      expect(brs(back)).toBe(1);
    },
  );

  it('does the same in a Markdown field of the item, and leaves a code block and a document alone', () => {
    const Detail = markdown.Detail;
    if (!Detail) throw new Error('markdown has no Detail');
    const field = { name: 'want', module: 'markdown' } as never;
    expect(brs(renderToStaticMarkup(<Detail field={field} value={'a\nb'} />))).toBe(1);
    expect(brs(renderToStaticMarkup(<Detail field={field} value={'a  \nb'} />))).toBe(1);
    expect(brs(renderToStaticMarkup(<Detail field={field} value={'```\nx\ny\n```'} />))).toBe(0);
    expect(brs(renderMarkdown('a\nb'))).toBe(0);
  });
});

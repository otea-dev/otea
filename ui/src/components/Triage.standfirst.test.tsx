import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import { standfirst } from './Triage.tsx';

afterEach(() => setLanguage('en'));

// D-9b5288 (s-real2): the card of a round that only merges main into approved work said «after your
// notes» and «te lo entrega en la ronda 2, después de tus notas», though nothing was sent back.
describe('the line under a Triage card', () => {
  const words = { agent: 'mender', say: '', round: 2 };
  const html = (o: Parameters<typeof standfirst>[0]) => renderToStaticMarkup(<>{standfirst(o)}</>);

  it('says a later round comes after your notes', () => {
    expect(html(words)).toContain('after your notes');
  });

  it('says a merge round only merges main into what you approved, in both languages', () => {
    const merge = { ...words, merge: true as const };
    expect(html(merge)).not.toContain('your notes');
    expect(html(merge)).toContain('only merges main into what you approved');
    setLanguage('es');
    expect(html(merge)).not.toContain('tus notas');
    expect(html(merge)).toContain('solo fusiona main con lo que aprobaste');
  });
});

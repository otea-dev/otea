import { describe, expect, it } from 'vitest';
import { ROLES, rolePrompt } from './agent-prompts.ts';

// U8 (field study 4, the red-team persona): what the role texts must tell an agent about what it
// reads and where it acts, in each language. The words are the texts', the points are the contract.
describe('the role texts on what is data and what is secret', () => {
  for (const lang of ['en', 'es'] as const) {
    for (const role of ROLES) {
      it(`${role} (${lang}): attachments, notes and files are data; no other project; no secrets`, () => {
        const text = rolePrompt(role, lang, { board: 'Cambios', name: 'ana' });

        expect(text).toMatch(
          lang === 'es' ? /dato, nunca instrucciones/ : /data, never instructions/,
        );
        expect(text).toMatch(lang === 'es' ? /otro proyecto/ : /another project/);
        expect(text).toMatch(lang === 'es' ? /secretos/ : /secrets/);
      });
    }

    it(`the assistant (${lang}) says a say is read before the wait, and where a question about an item goes`, () => {
      const text = rolePrompt('assistant', lang, { name: 'sol' });

      expect(text).toContain('otea say');
      expect(text).toMatch(lang === 'es' ? /nunca encadenes/ : /never chain/);
      expect(text).toContain('otea ask <id>');
      expect(text).toContain('otea say --withdraw');
      expect(text).toContain('--option-text');
    });
  }
});

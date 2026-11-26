import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { textOf } from '../html-text.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { AskBody } from '../views/hablar/Branch.tsx';

afterEach(() => setLanguage('en'));

// Field study 3: an agent's question filled the phone, paths and a command included.
const WALL = [
  'Para publicar la rama necesito que confirmes algo.',
  'Otea rechaza todo push desde D:/otea-explore/field3/s1/repos/tandas porque al repo se le agregó un remote después de que Otea lo viera por primera vez.',
  'El único remote es origin = D:/otea-explore/field3/s1/repos/remotes/tandas.git.',
  'Puedo correr otea repos add --name tandas --path D:/otea-explore/field3/s1/repos/tandas.',
  'Eso le dice a Otea que el remote es de confianza y deja pasar el push.',
].join(' ');

const app = {
  sync: { offline: false },
  session: { canWrite: true },
} as unknown as App;

const ask = (text: string) =>
  renderToStaticMarkup(
    <AppTestProvider value={app}>
      <AskBody
        by="claude-s1-cambios"
        about="CAM-1"
        text={text}
        options={['Sí, confío', 'No']}
        recommended={1}
        send={async () => undefined}
      />
    </AppTestProvider>,
  );

describe("an agent's question", () => {
  it('shows its first sentence and folds the rest behind «see more»', () => {
    // What is read on the page: markup attributes (the card's accessible name) are not.
    const shown = textOf(ask(WALL));
    expect(shown).toContain('Para publicar la rama necesito que confirmes algo.');
    expect(shown).not.toContain('otea repos add');
    expect(shown).toContain('see more');
  });

  it('shows a short question whole, with nothing to unfold', () => {
    const html = ask('¿Corto el parpadeo del menú o de la barra?');
    expect(html).toContain('¿Corto el parpadeo del menú o de la barra?');
    expect(html).not.toContain('see more');
  });
});

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

  // The card is a group named by its question: the name is the conclusion, not the wall.
  it('names the card by the first sentence of the question', () => {
    const html = ask(WALL);
    // And by the item it is about, so that three «¿Cómo seguimos?» are three names.
    expect(html).toContain(
      'aria-label="Para publicar la rama necesito que confirmes algo. · CAM-1"',
    );
    expect(html).not.toMatch(/aria-label="[^"]*otea repos add/);
  });

  // A numbered list in an ask is shown from its start, clamped, not cut at «1.».
  it('clamps a question that is a numbered list instead of cutting it at its first number', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map((n) => `${n}. Confirma el paso ${n}`)
      .join('\n');
    const html = ask(list);
    const shown = textOf(html);
    // Every item is in the page (clamped by its height), none hidden behind a cut after «1.».
    expect(shown).toContain('1. Confirma el paso 1');
    expect(shown).toContain('10. Confirma el paso 10');
    expect(html).toContain('st-clamp');
  });

  // H3 (field study 4, U1): the card showed «Aprobaste el arreglo.» and «ver más»; the question
  // itself (and what it would authorise) sat behind the fold, under buttons that already answered.
  it('always shows the question itself; only its context folds behind «see more»', () => {
    const text =
      'Aprobaste el arreglo. El proyecto no tiene remoto: no puedo subir la rama a ningún lado, ' +
      'sólo unirla a main en tu copia local. Esa unión se deshace con un revert, pero cambia los ' +
      'archivos que tienes abiertos. ¿La integro en tu copia principal?';
    const html = ask(text);
    const shown = textOf(html);
    expect(shown).toContain('¿La integro en tu copia principal?');
    expect(shown).not.toContain('Aprobaste el arreglo.');
    expect(shown).toContain('see more');
    expect(html).toContain('aria-label="¿La integro en tu copia principal? · CAM-1"');
  });

  it('leads with the last question when the context has questions of its own', () => {
    const shown = textOf(
      ask('¿Viste el cartel? Quedó en verde.\nLo pasé a crema para probar. ¿Lo dejo así?'),
    );
    expect(shown).toContain('¿Lo dejo así?');
    expect(shown).not.toContain('Lo pasé a crema');
  });

  it('shows a short question whole, with nothing to unfold', () => {
    const html = ask('¿Corto el parpadeo del menú o de la barra?');
    expect(html).toContain('¿Corto el parpadeo del menú o de la barra?');
    expect(html).not.toContain('see more');
  });
});

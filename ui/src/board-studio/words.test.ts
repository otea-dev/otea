import { afterEach, describe, expect, it } from 'vitest';
import { compileBoard } from '../../../src/core/board/compile.ts';
import { changePlan } from '../../../src/core/board/plan.ts';
import { problemsOf } from '../../../src/core/board/problems.ts';
import { cambios, creatures, errores, step } from '../../../src/core/board/testing.ts';
import { moduleAccepts } from '../../../src/core/placement.ts';
import { setLanguage, t } from '../i18n/i18n.ts';
import {
  changeText,
  doesText,
  kindGloss,
  kindName,
  problemText,
  reviewsText,
  targetName,
} from './words.ts';

afterEach(() => setLanguage('en'));

describe('problemText', () => {
  it('says every problem in words, in the language on screen', () => {
    const def = creatures();
    def.steps[1] = { ...(def.steps[1] ?? step('x', 'x')), name: 'Arte conceptual' };
    const [problem] = problemsOf(def, {});
    if (!problem) throw new Error('fixture');
    setLanguage('es');
    expect(problemText(problem)).toBe(
      '«Arte conceptual» se usa para una evidencia y un paso. En un tablero cada nombre es único, para que las menciones con @ no se confundan.',
    );
    setLanguage('en');
    expect(problemText(problem)).toBe(
      '“Arte conceptual” is used for a piece of evidence and a step. Each name on a board is unique, so @ mentions never mix them up.',
    );
  });

  it('counts uses of one kind instead of repeating them', () => {
    const def = creatures();
    def.steps[1] = { ...(def.steps[1] ?? step('x', 'x')), name: 'Concepto' };
    const problem = problemsOf(def, {}).find(({ code }) => code === 'duplicate_name');
    if (!problem) throw new Error('fixture');
    setLanguage('es');
    expect(problemText(problem)).toMatch(/^«Concepto» se usa para 2 pasos\./);
  });
});

describe('changeText', () => {
  it('says what publishing changes, as the design writes it', () => {
    setLanguage('es');
    expect(changePlan(null, creatures()).map(changeText)).toEqual([
      'Criaturas se crea con 3 pasos: Concepto, Animar y Pulir.',
    ]);
    const draft = creatures();
    draft.steps.push(step('snew', 'Montar', { doer: 'any', reviewer: 'any' }));
    draft.steps[0]?.hand.push({ ref: 'ecode', req: 'always', fresh: true });
    expect(changePlan(creatures(), draft).map(changeText)).toEqual([
      'Concepto entrega también Cambios de código, obligatorio y nuevo en cada ronda.',
      'Paso nuevo: Montar (cualquier agente lo hace, otro agente lo revisa).',
    ]);
  });
});

describe('who and kinds', () => {
  it('says who does and reviews a step, and names kinds and targets', () => {
    setLanguage('es');
    expect(doesText('any')).toBe('cualquier agente lo hace');
    expect(doesText('you')).toBe('lo haces tú');
    expect(reviewsText('none')).toBe('nadie lo revisa');
    expect(reviewsText('any')).toBe('otro agente lo revisa');
    expect(kindName('video')).toBe('Vídeo');
    expect(targetName(creatures(), 'done')).toBe('Hecho');
    expect(targetName(creatures(), 'sanimate')).toBe('Animar');
  });
});

describe('the later settings, in words', () => {
  it('says the publish sentences of the design in Spanish', () => {
    setLanguage('es');
    const plain = errores();
    plain.steps = plain.steps.map((s) => ({
      ...s,
      ways: [],
      note: { req: 'no' as const, hint: '' },
      waits: [],
      skipWhenReady: false,
      doerMayDrop: false,
    }));
    plain.drop = { by: 'anyone', motives: [] };
    delete plain.parts.fbranch?.guard;
    const draft = errores();
    draft.drop = {
      by: 'page',
      motives: [...draft.drop.motives, { id: 'wont_fix', name: 'No se arreglará' }],
    };
    const words = changePlan(plain, draft).map(changeText);
    expect(words).toEqual(
      expect.arrayContaining([
        'Si al crearlo ya trae todo, empieza en Triar.',
        'Triar puede devolverlo a Completar, con una nota.',
        'Arreglar: quien lo hace puede regresarlo a Triar diciendo por qué.',
        'Arreglar pide una nota en cada entrega.',
        'Arreglar no se entrega mientras haya Errores sin terminar, ni mientras lo frene algo sin terminar.',
        'Otea protege la Rama: se sube solo mientras se hace Arreglar, y se integra cuando está Hecho.',
        'Al descartar se elige un motivo: Rechazado, Duplicado o No se arreglará.',
        'Descartar lo haces tú, solo desde la página.',
      ]),
    );
  });

  it('words every new problem', () => {
    setLanguage('es');
    const def = cambios();
    delete def.split;
    const [wait] = problemsOf(def, {});
    if (!wait) throw new Error('fixture');
    expect(problemText(wait)).toBe(
      'Ejecutar espera a sus partes, pero Cambios no se divide en nada.',
    );
    const cycle = problemsOf(cambios(), {
      id: 'bcam',
      boards: [
        { id: 'bcam', name: 'Cambios', split: { board: 'brt', always: true } },
        { id: 'brt', name: 'Tareas de repo', split: { board: 'bcam', always: false } },
      ],
    }).find(({ code }) => code === 'split_cycle');
    if (!cycle) throw new Error('fixture');
    expect(problemText(cycle)).toBe(
      'Cambios se divide en Tareas de repo y Tareas de repo en Cambios: un ítem acabaría siendo parte de sí mismo.',
    );
    const skipped = errores();
    skipped.form = [{ ref: 'fsteps', required: true }];
    const [always] = problemsOf(skipped, {});
    if (!always) throw new Error('fixture');
    expect(problemText(always)).toBe(
      'Todo ítem nuevo se salta Completar: el formulario ya pide todo lo que entrega, así que nunca se hace. Haz opcional uno de esos campos o quita «Empezar directamente en…».',
    );
    setLanguage('en');
    expect(problemText(always)).toBe(
      'Every new item skips Completar: the form already asks for everything it hands, so it never runs. Make one of those fields optional or turn off “Start directly at…”.',
    );
  });
});

// P5-F1: «Vídeo o GIF» refused a .gif. What a kind's name and gloss promise is what its module takes.
describe('what a kind of evidence promises', () => {
  const kinds = ['images', 'video', 'audio', 'code', 'log', 'diagram', 'file'] as const;

  it.each(['en', 'es'] as const)(
    'is every extension and GIF its name and gloss mention, in %s',
    (language) => {
      setLanguage(language);
      for (const kind of kinds) {
        const def = creatures();
        def.parts.eproof = { id: 'eproof', name: 'Proof', kind, hint: '', options: [] };
        def.steps[0]?.hand.push({ ref: 'eproof', req: 'no', fresh: false });
        const [type] = compileBoard('bkinds', 1, def).types;
        const entry = Object.values(type?.layout ?? {})
          .flat()
          .flatMap((e) => ('module' in e ? [e] : []))
          .find(({ id }) => id === 'eproof');
        if (!entry) throw new Error(`no module for ${kind}`);
        const said = `${kindName(kind)} ${kindGloss(kind)}`;
        const promised = [
          ...(said.match(/\.[a-z0-9]+/g) ?? []),
          ...(/\bGIF/i.test(said) ? ['.gif'] : []),
        ];
        for (const extension of promised)
          expect(moduleAccepts(entry, `file${extension}`), `${kind} promises ${extension}`).toBe(
            true,
          );
      }
    },
  );

  // The picker's line over the kinds names them in one breath: GIF belongs to the images it takes,
  // never to the video that refuses it.
  it.each(['en', 'es'] as const)(
    'puts GIF with the images, not the video, in the picker, in %s',
    (language) => {
      setLanguage(language);
      const gloss = t('bs.editor.pick.evidence_gloss');
      const segment = gloss.split(/,\s*/).find((part) => /\bGIF/i.test(part)) ?? '';
      expect(segment).not.toBe('');
      expect(segment).toMatch(/images|imágenes/i);
      expect(segment).not.toMatch(/video|vídeo/i);
      // And what it says of video promises none of GIF.
      expect(kindName('video')).not.toMatch(/GIF/i);
      expect(kindGloss('video')).not.toMatch(/GIF/i);
    },
  );
});

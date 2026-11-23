import { describe, expect, it } from 'vitest';
import { evidenceByName, fieldsByName, findState, readFieldInput, stateName } from './reading.ts';
import { creatures, errores } from './testing.ts';

const def = creatures();

describe('reading a board item by names', () => {
  it('takes a field by its name or id, and a choice by its name or id', () => {
    expect(readFieldInput(def, { bioma: 'pantano', fdesc: 'Lenta' })).toEqual({
      fbiome: 'cswamp',
      fdesc: 'Lenta',
    });
    expect(readFieldInput(def, { Bioma: 'cwood' })).toEqual({ fbiome: 'cwood' });
    expect(readFieldInput(def, { Comprobaciones: 'Silueta, Paleta' })).toEqual({
      fsteps: '["cone","ctwo"]',
    });
    expect(readFieldInput(def, { Título: 'Rana' })).toEqual({ title: 'Rana' });
  });

  it('refuses a name the board has not, and a value no choice has, naming what there is', () => {
    expect(() => readFieldInput(def, { Tamaño: 'Una' })).toThrowError(
      'Criaturas has no field "Tamaño"; its fields are Descripción, Bioma, Comprobaciones',
    );
    expect(() => readFieldInput(def, { Bioma: 'Desierto' })).toThrowError(
      'Bioma must be one of Pantano, Bosque',
    );
  });

  it('names evidence, states and stored values the way the person wrote them', () => {
    expect(evidenceByName(def, 'arte conceptual')).toBe('eart');
    expect(() => evidenceByName(def, 'Bocetos')).toThrowError(/has no evidence "Bocetos"/);
    expect(stateName(def, 'sconcept')).toBe('Concepto');
    expect(stateName(def, 'sconcept__review')).toBe('Concepto (en revisión)');
    expect(stateName(def, 'done')).toBe('Done');
    expect(fieldsByName(def, { fbiome: 'cswamp', fdesc: 'Lenta' })).toEqual({
      Bioma: 'Pantano',
      Descripción: 'Lenta',
    });
  });

  // P1-F6: `attach --module terminal` failed where only the name "Terminal output" worked.
  it('takes evidence by its kind or the start of its name when that names exactly one', () => {
    expect(evidenceByName(def, 'video')).toBe('eanim');
    expect(evidenceByName(def, 'Animac')).toBe('eanim');
    expect(evidenceByName(def, 'cambios')).toBe('ecode');
    // Two parts begin with an a: no guess between them.
    expect(() => evidenceByName(def, 'a')).toThrowError(/"a" is ambiguous/);
    expect(() => evidenceByName(def, '')).toThrowError(/has no evidence ""/);
  });

  it('refuses a key that is one part’s kind and the start of another part’s name', () => {
    const odd = creatures();
    const code = odd.parts.ecode;
    if (!code) throw new Error('no ecode part');
    code.name = 'Images of the code';

    expect(() => evidenceByName(odd, 'images')).toThrowError(/"images" is ambiguous, it fits/);
    // Its full name still names it.
    expect(evidenceByName(odd, 'Images of the code')).toBe('ecode');
  });

  it('says a review in the board’s language and reads it in either language', () => {
    const english = creatures();
    english.title = 'Title';
    expect(stateName(english, 'sconcept__review')).toBe('Concepto (in review)');
    expect(findState(def, 'Concepto (en revisión)')).toBe('sconcept__review');
    expect(findState(def, 'concepto (in review)')).toBe('sconcept__review');
    expect(findState(english, 'Concepto (en revisión)')).toBe('sconcept__review');
  });

  it('says a level in the board’s language, as its field name is', () => {
    const spanish = creatures();
    spanish.parts.fsev = { id: 'fsev', name: 'Severidad', kind: 'level', hint: '', options: [] };
    expect(fieldsByName(spanish, { fsev: 'medium' })).toEqual({ Severidad: 'media' });
    const english = creatures();
    english.title = 'Title';
    english.parts.fsev = { id: 'fsev', name: 'Severity', kind: 'level', hint: '', options: [] };
    expect(fieldsByName(english, { fsev: 'critical' })).toEqual({ Severity: 'critical' });
  });

  it('fills the board description field when given "description", in any language', () => {
    // Criaturas has one long text, Descripción: "description" fills it.
    expect(readFieldInput(def, { description: 'Lenta' })).toEqual({ fdesc: 'Lenta' });
    // A board with several long texts takes the one named Description, in English or Spanish.
    const several = errores();
    several.parts.fdesc = { id: 'fdesc', name: 'Descripción', kind: 'long', hint: '', options: [] };
    several.form = [...several.form, { ref: 'fdesc', required: true }];
    expect(readFieldInput(several, { description: 'Se cae' })).toEqual({ fdesc: 'Se cae' });
  });

  it('fills the first long text the creation form asks when none is named Description', () => {
    const several = errores();
    several.parts.fnotes = { id: 'fnotes', name: 'Notas', kind: 'long', hint: '', options: [] };
    several.form = [
      { ref: 'fnotes', required: false },
      { ref: 'fsteps', required: true },
    ];
    expect(readFieldInput(several, { description: 'x' })).toEqual({ fnotes: 'x' });
  });

  it('refuses "description" with the long texts named when the form asks none of several', () => {
    const several = errores();
    several.parts.fnotes = { id: 'fnotes', name: 'Notas', kind: 'long', hint: '', options: [] };
    several.anytime = [...several.anytime, 'fnotes'];
    expect(() => readFieldInput(several, { description: 'x' })).toThrowError(
      'Errores has no description field; fill one of its long texts by name: Pasos, Notas',
    );
  });

  it('refuses the description field given twice, once as "description" and once by its name', () => {
    expect(() => readFieldInput(def, { description: 'a', Descripción: 'b' })).toThrowError(
      'Descripción given twice',
    );
  });
});

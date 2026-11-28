import { describe, expect, it } from 'vitest';
import { optionsNeedingWords, promisesOwnWords } from './own-words.ts';

// Field study 5: the options the person tapped and that read «escribo…» were sent as they stood.
describe('an option that promises the person’s own words', () => {
  it.each([
    'Corregir a CABA y poner el plazo (escribo cuánto tardan)',
    'Escribo la dirección o el usuario en la respuesta',
    'Te escribo las fechas en mi respuesta',
    'No es esa: te escribo la dirección correcta',
    'Sí, y la explico al responder',
    "I'll write the date in my answer",
    'Let me explain what I mean',
    'Other, in my own words',
  ])('is told by its words: %s', (label) => {
    expect(promisesOwnWords(label)).toBe(true);
  });

  it.each([
    'Dejarlo así',
    'Sí, publicarlo',
    'Corregir a CABA',
    'Escribir las pruebas primero',
    'Use the second one',
    'I will fix it now',
  ])('is not taken for one when it only decides: %s', (label) => {
    expect(promisesOwnWords(label)).toBe(false);
  });

  it('adds the ones that promise to the ones the agent marked', () => {
    const options = ['Dejarlo así', 'Te escribo las fechas', 'Cancelar', 'Otro'];
    expect(optionsNeedingWords(options)).toEqual([2]);
    expect(optionsNeedingWords(options, [4])).toEqual([2, 4]);
  });
});

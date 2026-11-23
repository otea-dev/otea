import { describe, expect, it } from 'vitest';
import { ago, item } from '../derive/fixtures.ts';
import { findItems, SEARCH_MAX } from './search.ts';

// The phone's search finds items by what they say, as the desk's search reads words.

const all = [
  item({ id: 'CAM-1', title: 'Corregir el login', updatedAt: ago(50) }),
  item({ id: 'CAM-2', title: 'Añadir modo oscuro', fields: { Detalle: 'Migración de estilos' } }),
  item({ id: 'CAM-3', title: 'Revisar la API de pagos', updatedAt: ago(5) }),
  item({ id: 'CAM-4', title: 'Login con Google', turn: 'none', closes: 'done', updatedAt: ago(1) }),
];

const ids = (search: string) => findItems(all, search).map((found) => found.id);

describe('findItems', () => {
  it('finds by a word of the title, with no care for accents or case', () => {
    expect(ids('ANADIR')).toEqual(['CAM-2']);
    expect(ids('revisar pagos')).toEqual(['CAM-3']);
  });

  it('finds by a value of a field, and by a plural or the start of a word', () => {
    expect(ids('migraciones')).toEqual(['CAM-2']);
    expect(ids('estil')).toEqual(['CAM-2']);
  });

  it('puts an id typed whole first, then the item holding most of the words', () => {
    expect(ids('cam-3')[0]).toBe('CAM-3');
    expect(ids('login google')).toEqual(['CAM-4', 'CAM-1']);
  });

  it('puts open items before closed ones that hold as much, and shows nothing for a blank search', () => {
    expect(ids('login')).toEqual(['CAM-1', 'CAM-4']);
    expect(ids('   ')).toEqual([]);
    expect(ids('zzzz')).toEqual([]);
  });

  it('keeps one page of results', () => {
    const many = Array.from({ length: SEARCH_MAX + 10 }, (_, n) =>
      item({ id: `X-${n}`, title: 'tarea común' }),
    );
    expect(findItems(many, 'tarea')).toHaveLength(SEARCH_MAX);
  });
});

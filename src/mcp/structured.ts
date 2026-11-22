import { z } from 'zod';

// What an MCP tool result carries as data beside its text: the item as one small object, its fields
// by name, for a client that reads fields as data rather than parsing the text. Not the whole item
// --json prints (its events, moves and evidence cost tokens in clients that show both): what an
// agent reads again, as MCP-TOKENS measured.

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The fields of an item as --json gives them ({ id, name, value, label? } each) by their names, a
// choice by its label.
function fieldsByName(fields: readonly unknown[]): Record_ {
  return Object.fromEntries(
    fields.flatMap((field) =>
      isRecord(field) && typeof field.name === 'string'
        ? [[field.name, field.label ?? field.value]]
        : [],
    ),
  );
}

// The item as data (the itemData of the CLI), compact; undefined when the data is no item. Without
// `withFields`, its place only (the row wait wakes an agent with: next gives the item).
export function compactItem(data: unknown, withFields = true): Record_ | undefined {
  if (!isRecord(data) || typeof data.id !== 'string' || !Array.isArray(data.fields))
    return undefined;
  const { id, collection, title, stateName, state, turn, lease } = data;
  return {
    id,
    ...(typeof collection === 'string' ? { collection } : {}),
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof (stateName ?? state) === 'string' ? { state: stateName ?? state } : {}),
    ...(typeof turn === 'string' ? { turn } : {}),
    ...(isRecord(lease) ? { lease } : {}),
    ...(withFields ? { fields: fieldsByName(data.fields) } : {}),
  };
}

// What next adds to its answer for the item it offers: the item's compact data under the keys the
// answer does not already have (item is its id).
export function offeredFields(data: unknown): Record_ {
  const { id: _id, collection: _collection, ...rest } = compactItem(data) ?? {};
  return rest;
}

// What a result says besides its text and the data of its own that no client reads as one: next's
// answer carries both, and its profile is a confirmation line.
const TEXT_ONLY = new Set(['text', 'profile', 'hint', 'reminder']);

// The structured content of a tool result, for show (the item), next (the id of the item to take,
// or none, with what offers it) and wait (the item that woke it: where it stands, not its fields);
// undefined for anything else, which is text alone.
export function structuredOf(tool: string, data: unknown): Record_ | undefined {
  if (!isRecord(data)) return undefined;
  if (tool === 'show') return compactItem(data);
  if (tool === 'wait') return compactItem(data, false);
  if (tool === 'next') {
    return Object.fromEntries(Object.entries(data).filter(([key]) => !TEXT_ONLY.has(key)));
  }
  return undefined;
}

// What otea wait gives when nothing reached the turn in time: a result, not an error, that says so.
export function timedOut(message: string): Record_ {
  return { timedOut: true, message };
}

// The tools' output schemas, which clients read to know what structuredContent holds. Only the
// tools that return one item or an offer: each schema is in every client's tool list.
const FIELDS = z.record(z.string(), z.unknown());

export const OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  show: z.looseObject({ id: z.string(), state: z.string().optional(), fields: FIELDS }),
  next: z.looseObject({
    item: z.string().nullable().describe('the item to take, none when null'),
    fields: FIELDS.optional(),
  }),
  wait: z.looseObject({ timedOut: z.boolean().optional().describe('nothing arrived: wait again') }),
};

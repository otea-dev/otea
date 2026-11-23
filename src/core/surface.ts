// Where a move the person made came from, kept on its event beside the channel (`ui`), which says
// only that it came over HTTP (P1-S1): the desk, the phone, or a direct API call made with the
// person's session, which never went through the page. The page marks its own requests with a
// header; a call without it is a direct one. It is a record for whoever reads the history, not a
// guard: a program may send the header too.

export const SURFACES = ['desk', 'phone', 'api'] as const;

export type Surface = (typeof SURFACES)[number];

export const SURFACE_HEADER = 'x-otea-ui';

export function isSurface(value: unknown): value is Surface {
  return SURFACES.some((surface) => surface === value);
}

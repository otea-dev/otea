import type { EventRecord } from '../../store/queries.ts';

// A file a step's handoff asks for (a screenshot, a recording) that the person said the item does
// without: an agent with no way to make one (no browser, no display) would otherwise be stuck on
// the step. Only the person records it; the handoff then passes without the file, and the item's
// page and `show` say the person waived it.
export const EVIDENCE_WAIVED = 'evidence_waived';

export type Waiver = {
  // The part (a board part id) and its name at the time.
  part: string;
  name: string;
  reason?: string;
  at: string;
  by: string;
};

// The waivers recorded on an item, one per part (the last wins), in the order first given.
export function waiversFrom(events: readonly EventRecord[]): Waiver[] {
  const out = new Map<string, Waiver>();
  for (const event of events) {
    if (event.type !== EVIDENCE_WAIVED || event.actor.kind !== 'human') continue;
    const { data } = event;
    const part = String(data.part ?? '');
    if (!part) continue;
    out.set(part, {
      part,
      name: String(data.name ?? part),
      ...(typeof data.reason === 'string' && data.reason !== '' ? { reason: data.reason } : {}),
      at: event.at,
      by: event.actor.name,
    });
  }
  return [...out.values()];
}

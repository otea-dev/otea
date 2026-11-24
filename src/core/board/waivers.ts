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

// The waivers given since `since` (the round start), one per part (the last wins): a send-back
// starts a round that asks for the file again.
export function waiversFrom(events: readonly EventRecord[], since?: string): Waiver[] {
  const out = new Map<string, Waiver>();
  for (const event of events) {
    if (event.type !== EVIDENCE_WAIVED || event.actor.kind !== 'human') continue;
    if (since !== undefined && event.at < since) continue;
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

// The file parts a person may waive: pictures and recordings an agent may have no way to make (no
// browser for a screenshot). The code and logs of a change are its core evidence: never waived.
export const WAIVABLE_KINDS: readonly string[] = ['images', 'video'];

export function isWaivable(part: { kind: string }): boolean {
  return WAIVABLE_KINDS.includes(part.kind);
}

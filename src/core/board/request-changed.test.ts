import { describe, expect, it } from 'vitest';
import { requestChangedAfterHandoff } from './request-changed.ts';

const quill = { kind: 'agent' as const, name: 'quill' };
const you = { kind: 'human' as const, name: 'fede' };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 27, 9, minute)).toISOString();

const handoff = {
  type: 'transitioned',
  actor: quill,
  at: at(0),
  data: { from: 'doit', to: 'doit__review' },
};
const update = (
  actor: typeof quill | typeof you,
  changes: Record<string, unknown>,
  minute = 5,
) => ({
  type: 'updated',
  actor,
  at: at(minute),
  data: { changes },
});
const isRequest = (key: string) => key === 'title' || key === 'want';

// Review of H2: a branch pushed, a link or a checklist edited after the handoff is bookkeeping, no
// change of what the person asked for.
describe('which changes after a handoff count as the request changing', () => {
  it('ignores a bookkeeping field, and counts the title or a request field', () => {
    const events = [
      handoff,
      update(you, { branch: { from: 'a', to: 'b' } }),
      update(you, { want: { from: 'CSV', to: 'JSON' } }, 6),
    ];

    expect(requestChangedAfterHandoff(events, isRequest)?.changes).toEqual([
      { field: 'want', from: 'CSV', to: 'JSON' },
    ]);
    expect(requestChangedAfterHandoff(events.slice(0, 2), isRequest)).toBeUndefined();
  });

  it('ignores a subagent of the agent that handed it in, never the person', () => {
    const sub = { kind: 'agent' as const, name: 'quill-haiku' };
    const other = { kind: 'agent' as const, name: 'quillbert' };

    expect(
      requestChangedAfterHandoff(
        [handoff, update(sub, { title: { from: 'a', to: 'b' } })],
        isRequest,
      ),
    ).toBeUndefined();
    expect(
      requestChangedAfterHandoff(
        [handoff, update(other, { title: { from: 'a', to: 'b' } })],
        isRequest,
      ),
    ).toMatchObject({ by: 'quillbert' });
    expect(
      requestChangedAfterHandoff(
        [handoff, update(you, { title: { from: 'a', to: 'b' } })],
        isRequest,
      ),
    ).toMatchObject({ by: 'fede' });
  });
});

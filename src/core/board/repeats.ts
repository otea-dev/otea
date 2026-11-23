import { type History, roundsOfStep } from './history.ts';
import { type BoardDefinition, isEvidence, type Step } from './model.ts';

// A file of a part new each round may hold the very bytes of the round before: attaching it again is
// what the step asks for when nothing changed, so the handoff takes it, and says so (P5-F1) while
// the review shows the same.
export type Repeated = { part: string; name: string; round: number };

// What the handoff adds to its line, one per repeated part: not a refusal, a word.
export function repeatedLines(repeated: readonly Repeated[]): string[] {
  return repeated.map(
    ({ name, round }) =>
      `Note: ${name}: same bytes as round ${round}; the review shows it unchanged.`,
  );
}

// The parts of evidence the step marks new each round whose files of the current round include one
// with the bytes of a file the part held in the round before: the part, and that round's number.
// Files with no bytes or no known hash never match. Nothing in a first round.
export function repeatedFresh(
  def: BoardDefinition,
  step: Step,
  history: History,
  evidence: readonly { part: string; at: string; size?: number; sha256?: string }[],
): Repeated[] {
  const starts = roundsOfStep(def, history, step.id);
  const now = starts.at(-1);
  const before = starts.at(-2);
  if (!now || !before) return [];
  const out: Repeated[] = [];
  for (const hand of step.hand) {
    const part = def.parts[hand.ref];
    if (!hand.fresh || !part || !isEvidence(part)) continue;
    const mine = evidence.filter(({ part: ref, size }) => ref === hand.ref && size !== 0);
    const earlier = new Set(
      mine.flatMap(({ at, sha256 }) =>
        at >= before.at && at < now.at && sha256 !== undefined ? [sha256] : [],
      ),
    );
    const again = mine.some(
      ({ at, sha256 }) => at >= now.at && sha256 !== undefined && earlier.has(sha256),
    );
    if (again) out.push({ part: part.id, name: part.name, round: before.round });
  }
  return out;
}

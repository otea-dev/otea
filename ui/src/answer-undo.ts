import type { AnswerWords } from './api.ts';

// Which answers the server takes back (src/app/questions.ts retractItemAnswer): only a tap on one of
// the question's own options, never words you wrote, a note added to an option, or leaving the
// decision to the agent. The toast of any other answer offers no Deshacer.
export function answerUndoable(given: AnswerWords): boolean {
  return 'option' in given && given.note === undefined && given.explain === undefined;
}

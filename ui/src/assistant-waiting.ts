import type { AssistantWaiting } from '../../src/core/assistant.ts';
import { language, t } from './i18n/i18n.ts';

export const NOTHING_WAITING: AssistantWaiting = {
  count: 0,
  since: null,
  messages: 0,
  notes: 0,
  reports: 0,
};

// What waits for the assistant, said by every surface in the same words: «2 messages, 1 note». The
// parts are what the server counted (src/app/assistant-waiting.ts), so «messages» are only the
// person's messages: a note nobody took or what an agent escalated is named as that, never counted
// as a message (s-real2, D-fbe122).
export function waitingWords(waiting: AssistantWaiting): string {
  const parts = [
    waiting.messages > 0 ? t('assistant.waiting.messages', { count: waiting.messages }) : '',
    waiting.notes > 0 ? t('assistant.waiting.notes', { count: waiting.notes }) : '',
    waiting.reports > 0 ? t('assistant.waiting.reports', { count: waiting.reports }) : '',
  ].filter((part) => part !== '');
  return new Intl.ListFormat(language(), { style: 'long', type: 'conjunction' }).format(parts);
}

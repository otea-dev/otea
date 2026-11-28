import type { MessageFile } from './conversation.ts';
import { OteaError } from './errors.ts';

// The Bandeja (0.8): the project's inbox of rough notes the person captured from the desk or the
// phone, a free text with files and no board form. It is not a board: an entry waits for the
// assistant, is taken by one refiner (the assistant itself, or a subagent it launched), who turns it
// into a proper item on the right board, or asks the person on the entry what is missing (with
// options to tap), and ends filed under the item it became. The person captures only through the
// desk's authenticated routes (app/bandeja.ts); an agent never makes an entry.

// How long a refiner holds an entry it took without doing anything on it (a lease, as an item's):
// it keeps the hold by acting (take again, ask, file); past it another refiner may take the entry.
export const BANDEJA_LEASE_MS = 30 * 60_000;

// Where an entry stands:
//   waiting   nobody has it: the assistant is told
//   refining  a refiner holds it (`claimedBy`)
//   asking    a refiner asked the person something and waits for the answer
//   filed     it became an item (`item`)
//   closed    the assistant or its refiner closed it with a reason (`closeReason`); it waits for
//             nobody, and the person may reopen it
export const BANDEJA_STATES = ['waiting', 'refining', 'asking', 'filed', 'closed'] as const;

export type BandejaState = (typeof BANDEJA_STATES)[number];

// A question the refiner asked on the entry, with the options it offers to tap (the same as an
// item's: core/board/questions.ts) and the person's answer once there is one.
export type BandejaQuestion = {
  question: number;
  text: string;
  at: string;
  by: string;
  options?: string[];
  recommended?: number;
  // The options that need the person's own words (ask --option-text), by number from 1.
  optionText?: number[];
  answer?: {
    text: string;
    at: string;
    mode: 'option' | 'text' | 'delegated';
    option?: number;
  };
};

export type BandejaEntry = {
  id: number;
  // How people and agents name it: B-3.
  ref: string;
  text: string;
  at: string;
  // The person's name as the desk shows it.
  by: string;
  attachments: MessageFile[];
  state: BandejaState;
  // The refiner that holds it, and until when, while it is refining.
  claimedBy: string | null;
  claimUntil: string | null;
  // The questions asked on it, oldest first, and the one that waits for the person, if any.
  questions: BandejaQuestion[];
  asking: BandejaQuestion | null;
  // The item it became, who filed it and when.
  item: string | null;
  filedBy: string | null;
  filedAt: string | null;
  // Who closed it, when and why, while it is closed.
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
};

// The id prefix of an entry. No board may have it (prefixFor in core/item.ts refuses), so B-3 is
// never an item.
export const BANDEJA_PREFIX = 'B';

export const bandejaRef = (id: number): string => `${BANDEJA_PREFIX}-${id}`;

// An entry as a person or an agent writes it: 3, #3, b3 or B-3.
export function bandejaIdOf(text: string): number {
  const id = Number(text.trim().replace(/^(#|b-?)/i, ''));
  if (!Number.isInteger(id) || id < 1) {
    throw new OteaError(
      'invalid_fields',
      `Not an Inbox entry: ${text}. Pass its number, such as B-3 (otea bandeja lists them)`,
    );
  }
  return id;
}

// Whether a name given for an item or an entry is a Bandeja entry: B-3. An item's id is a board's
// prefix and a number, and the prefix B is reserved, so the two never meet.
export function isBandejaRef(text: string): boolean {
  return /^b-\d+$/i.test(text.trim());
}

// The entry an item came from: what the item's page and `otea show` say.
export type FromBandeja = { id: number; ref: string; at: string; snippet: string };

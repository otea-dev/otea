import type { KeyboardEvent } from 'react';

// Ctrl+Enter (Cmd+Enter on a Mac) sends what a note box holds; Enter alone stays a new line. One
// place for the note boxes of the desk and the phone (D-33d880): a person on the keys never had to
// tab out to the button. Never mid-composition: Enter then picks a candidate.
export function sendsOnCtrlEnter(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'preventDefault'
  > & { nativeEvent?: { isComposing?: boolean } },
  send: () => void,
): boolean {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return false;
  if (event.altKey || event.shiftKey || event.nativeEvent?.isComposing) return false;
  event.preventDefault();
  send();
  return true;
}

// For the box's own attributes: the key a reader is told about.
export const SEND_KEYS = 'Control+Enter Meta+Enter';

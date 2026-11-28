import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textOf } from '../html-text.ts';
import { AssistantDot } from './Rail.tsx';

// The assistant's state on its row of the rail is a colour; a screen reader gets it in words.
describe('the assistant’s dot', () => {
  const state = (name: 'listening' | 'connected' | 'offline') =>
    textOf(
      renderToStaticMarkup(
        <AssistantDot status={{ name: 'quill', state: name, since: null, pending: 0 }} />,
      ),
    );

  it('says in words what its colour says', () => {
    expect(state('listening')).toBe('quill is listening');
    expect(state('connected')).toBe('quill is connected');
    expect(state('offline')).toBe('quill is offline');
  });

  it('is nothing while the project has no assistant', () => {
    expect(renderToStaticMarkup(<AssistantDot status={null} />)).toBe('');
  });
});

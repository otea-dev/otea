import { Fragment, type ReactNode, useCallback, useState } from 'react';
import { type AgentPromptView, fetchAgentPrompt } from '../api.ts';
import { useRemote } from '../hooks.ts';
import { language, t } from '../i18n/i18n.ts';
import { Button } from '../kit/Button.tsx';
import { Icon } from '../kit/Icon.tsx';
import type { Remote } from '../remote.ts';
import { CopyGlyph } from './CopyCommand.tsx';

// Copies a text, and says so for a moment.
export function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };
  return [copied, copy];
}

// A command that wraps only between its words, never inside one (at an option's hyphen).
export function CommandWords({ text }: { text: string }) {
  return text.split(' ').map((word, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the words never move
    <Fragment key={index}>
      {index > 0 ? ' ' : null}
      <span className="nw">{word}</span>
    </Fragment>
  ));
}

// The instruction as the agent gets it, its `commands` set as code (copied as written).
export function withCode(text: string) {
  return text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts never move
      <code key={index} className="inl">
        <CommandWords text={part} />
      </code>
    ) : (
      part
    ),
  );
}

// The prompt the server writes for this project and this screen's language, read again when the
// project changes (`version`): who listens and what waits move.
export function useAgentPrompt(
  kind: AgentPromptView['kind'] | undefined,
  version: number,
): Remote<AgentPromptView> {
  const lang = language();
  const load = useCallback(
    (signal: AbortSignal) => fetchAgentPrompt(kind, lang, signal),
    [kind, lang],
  );
  return useRemote(load, version, 'live');
}

// What the person may open to see the machinery: shut by default, it opens slowly.
export function TechDetails({ children }: { children: ReactNode }) {
  return (
    <details className="tech">
      <summary>
        <Icon name="chevron" />
        {t('connect.tech.summary')}
      </summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}

// What to paste into the agent's chat, and the button that copies it whole. `primary` when it is
// the first thing to do on the page. `fold` keeps the instruction, which speaks to the agent in its
// own terms, behind «Detalles técnicos» (with `tech`, whatever else belongs there): the person
// copies it without reading it. Unfolded, it is one numbered line per paragraph.
export function PromptBlock({
  prompt,
  primary = false,
  fold = false,
  tech,
}: {
  prompt: string;
  primary?: boolean;
  fold?: boolean;
  tech?: ReactNode;
}) {
  const [copied, copy] = useCopy(prompt);
  const text = (
    <blockquote className="cprompt">
      {prompt.split('\n').map((line) => (
        <p key={line}>{withCode(line)}</p>
      ))}
    </blockquote>
  );
  const button = (
    <Button variant={primary ? 'primary' : 'quiet'} onClick={copy}>
      <CopyGlyph />
      {copied ? t('connect.copiedPrompt') : t('connect.copyPrompt')}
    </Button>
  );
  // The instruction is the agent's, in its terms: the person needn't read them.
  if (fold) {
    return (
      <div className="cprompt-wrap cprompt-fold">
        <div className="cprompt-act">
          {button}
          <p className="cprompt-aside">{t('connect.forAgent')}</p>
        </div>
        <TechDetails>
          <p className="cprompt-label">{t('connect.tech.instruction')}</p>
          {text}
          {tech}
        </TechDetails>
      </div>
    );
  }
  return (
    <div className="cprompt-wrap">
      <p className="cprompt-for">{t('connect.forAgent')}</p>
      {text}
      {button}
    </div>
  );
}

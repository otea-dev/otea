import { useCallback } from 'react';
import { fetchRolePrompt } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { useCopy } from '../../components/AgentPrompt.tsx';
import { CopyCommand, CopyGlyph } from '../../components/CopyCommand.tsx';
import { useRemote } from '../../hooks.ts';
import { t } from '../../i18n/i18n.ts';
import { Button } from '../../kit/index.ts';

// The secretary is away: it restarts on the computer, and the person may be on a phone. The text
// that makes an agent the secretary is one tap in the line over the conversation (the text is read
// before the tap, so the copy is the tap's own: a browser lends the clipboard to a click, not to
// what a request answers later); the plain words of where it restarts and the two commands, as the
// second way, fold open under it (field study 4: «pídele a tu agente que ejecute otea wait…» was all
// a phone showed).

export function useSecretaryText(name: string): {
  text: string;
  copied: boolean;
  copy: () => void;
} {
  const app = useApp();
  const load = useCallback(
    (signal: AbortSignal) => fetchRolePrompt('secretary', { name }, signal),
    [name],
  );
  const prompt = useRemote(load, app.version, 'live');
  const text = prompt.status === 'ready' ? prompt.value.prompt : '';
  const [copied, copy] = useCopy(text);
  return { text, copied, copy };
}

// «Copiar»: the secretary's text, to paste into the agent's session. Quiet, on the line.
export function AwayCopy({ name }: { name: string }) {
  const { text, copied, copy } = useSecretaryText(name);
  return (
    <>
      <Button
        size="sm"
        className="hb-away-copy"
        disabled={text === ''}
        aria-label={t('hablar.none.copy')}
        onClick={copy}
      >
        <CopyGlyph />
        <span className="lb">{copied ? t('hablar.none.copied') : t('hablar.block.copy')}</span>
      </Button>
      <CopiedSay copied={copied} />
    </>
  );
}

// «Copiado», said to a reader: the button only changes its own words, which a reader on it does
// not hear (field study 6).
export function CopiedSay({ copied }: { copied: boolean }) {
  return (
    <span className="visually-hidden hb-copied" role="status">
      {copied ? t('hablar.none.copied') : ''}
    </span>
  );
}

// Where it restarts, and the commands for the person who would rather run them.
export function AwayHow({ name }: { name: string }) {
  const app = useApp();
  return (
    <>
      {/* On the computer, «no desde aquí» says nothing: the person is where it restarts. */}
      <p className="hb-back">{t(app.phone ? 'hablar.away.back' : 'hablar.away.back.desk')}</p>
      <details className="hb-cmds">
        <summary>{t('hablar.away.cmds')}</summary>
        <p>{t('hablar.away.cmdWait')}</p>
        <CopyCommand command={`otea wait --secretary --as ${name}`} />
        <p>{t('hablar.away.cmdPrompt')}</p>
        <CopyCommand command={`otea prompt --role secretary --as ${name}`} />
      </details>
    </>
  );
}

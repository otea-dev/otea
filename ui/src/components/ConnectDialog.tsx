import type { AgentPromptView } from '../api.ts';
import { useApp } from '../app/context.tsx';
import { useWorkspace } from '../app/workspace.ts';
import { t, tx } from '../i18n/i18n.ts';
import { Button } from '../kit/Button.tsx';
import { Dialog } from '../kit/pop/Dialog.tsx';
import { PromptBlock, useAgentPrompt } from './AgentPrompt.tsx';
import { ledeKey, whereKey } from './connect-words.ts';

// Conectar un agente (SPEC §10.4): one text to paste into the agent's chat, written by the server for
// the project's moment. A project with no board of its own gets the whole first contact (set up,
// connect, read the project, interview the person, draft its boards); one with boards gets the join
// prompt, written from the project now (a name nobody listening has, the boards and their agent
// steps, what waits) so one more agent works alongside the others. Opened by openConnect(), from the
// agents menu, the agents column, an empty board and the empty project.
export function ConnectDialog() {
  const app = useApp();
  const ws = useWorkspace();
  return (
    <Dialog
      open={ws.connect}
      label={t('connect.title')}
      onClose={app.closeConnect}
      size="md"
      className="connect"
    >
      <ConnectBody version={app.version} />
      <div className="dbtns" data-i="">
        <Button variant="quiet" onClick={app.closeConnect}>
          {t('connect.done')}
        </Button>
      </div>
    </Dialog>
  );
}

function ConnectBody({ version }: { version: number }) {
  const remote = useAgentPrompt(undefined, version);
  return <ConnectView view={remote.status === 'ready' ? remote.value : null} />;
}

// The dialog's words for the project's moment, and its prompt once the server wrote it. The person
// reads what the agent will do and where (plain words, written for code or for a folder of files);
// the instruction and how it connects are behind «Detalles técnicos».
export function ConnectView({ view }: { view: AgentPromptView | null }) {
  const where = whereKey(view);
  const boards = view?.boards ?? [];
  return (
    <>
      <h4 data-i="">{t('connect.title')}</h4>
      <p data-i="">{t(ledeKey(view))}</p>
      {boards.length > 0 ? (
        <div className="cboards" data-i="">
          <p className="cnote">{t('connect.boards')}</p>
          <ul>
            {boards.map(({ name, steps }) => (
              <li key={name}>
                <b>{name}</b>
                <span>{steps.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {where ? (
        <p className="cnote" data-i="">
          {t(where)}
        </p>
      ) : null}
      <div data-i="" className="cpaste">
        {view ? (
          <PromptBlock
            prompt={view.prompt}
            primary
            fold
            tech={
              <>
                {/* Every agent connects the same way, whatever its harness: Otea writes no harness config. */}
                <p className="cnote">
                  {tx('connect.tech.mcp', { connect: <code className="inl">otea connect</code> })}
                </p>
                <p className="cnote">{t('connect.tech.check')}</p>
              </>
            }
          />
        ) : null}
      </div>
      <p className="cnote" data-i="">
        {t('connect.appears')}
      </p>
    </>
  );
}

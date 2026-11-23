import { useState } from 'react';
import { useApp } from '../app/context.tsx';
import { useBoards } from '../board-studio/home/boards-store.ts';
import { openNewBoard } from '../board-studio/home/studio-dialogs.ts';
import { t } from '../i18n/i18n.ts';
import { Button } from '../kit/Button.tsx';
import { Icon, type IconName } from '../kit/Icon.tsx';
import { dismissNextStep, firstFinishedRecently, nextStepDismissed } from '../next-step.ts';

type Move = { key: 'pair' | 'board' | 'agent'; icon: IconName; run: () => void };

// After a project's first finished item nothing said what comes next: this does, once. It rests
// under the day's heading with three things people usually do (pair a phone, make another board,
// invite another agent), and goes for good with «Ahora no» or with the press of any of them.
export function NextStep() {
  const app = useApp();
  const project = app.project?.id;
  const [gone, setGone] = useState(() => project === undefined || nextStepDismissed(project));
  const [leaving, setLeaving] = useState(false);
  const boards = useBoards(app.version);
  // Until the boards are known, nothing says which items are the person's work. Only the items of
  // the person's own boards count: the built-in Pedidos board (a board request, closed by
  // publishing) never does, and an item of a board the list does not hold yet (the Pedidos board
  // made a moment ago, before the list reloaded on the new version) waits for it.
  if (gone || boards.status !== 'ready') return null;
  const work = new Set(
    boards.boards.flatMap((b) => (!b.builtin && b.collection ? [b.collection] : [])),
  );
  if (!firstFinishedRecently(app.all, app.now, work)) return null;

  const put = () => {
    if (project !== undefined) dismissNextStep(project);
    setLeaving(true);
    window.setTimeout(() => setGone(true), 360);
  };
  const moves: Move[] = [
    ...(app.session.canManageDevices && !app.phone
      ? [
          {
            key: 'pair' as const,
            icon: 'link' as const,
            run: () => app.go({ view: 'lan' }),
          },
        ]
      : []),
    ...(app.session.canConfigure
      ? [{ key: 'board' as const, icon: 'cards' as const, run: () => openNewBoard(null) }]
      : []),
    { key: 'agent', icon: 'plus', run: app.openConnect },
  ];
  return (
    <aside className="nextstep" data-leaving={leaving || undefined} aria-label={t('next.label')}>
      <div className="ns-head">
        <h4>{t('next.title')}</h4>
        <p>{t('next.body')}</p>
      </div>
      <ul className="ns-moves">
        {moves.map(({ key, icon, run }) => (
          <li key={key}>
            <button
              type="button"
              className="ns-move"
              onClick={() => {
                put();
                run();
              }}
            >
              <Icon name={icon} />
              <span className="ns-what">
                <b>{t(`next.${key}`)}</b>
                <small>{t(`next.${key}Note`)}</small>
              </span>
              <Icon name="right" className="ns-go" />
            </button>
          </li>
        ))}
      </ul>
      <div className="ns-foot">
        <Button variant="quiet" size="sm" onClick={put}>
          {t('next.dismiss')}
        </Button>
        <span>{t('next.once')}</span>
      </div>
    </aside>
  );
}

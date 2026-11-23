import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { t, useLanguage } from '../i18n/i18n.ts';
import { Button } from '../kit/index.ts';
import { CopyCommand } from './CopyCommand.tsx';

// What the app says when its browser's sign-in ran out (P8-F4): the PC answers and refuses every
// read, so the project is not empty and the PC is not away. It is the pairing screen's own page,
// the desk and this browser on one broken lane, then the way back in: `otea open` (a command to
// copy, never one that runs) and Volver a intentar, which reads everything again; the page also
// comes back by itself as soon as a read goes through, so a link opened in another tab brings it
// back without a press.

// The lane is cut between the two ends: dashed, never drawn, and this browser's node is a gap.
function BrokenRoute({ desk }: { desk: string }) {
  return (
    <div className="pair-route ask">
      <svg className="pair-lane" width="40" height="156" viewBox="0 0 40 156" aria-hidden="true">
        <path className="pair-lane-dash" d="M20 32 V124" />
        <circle className="pair-lane-dot" cx="20" cy="32" r="3.5" />
      </svg>
      <div className="pair-end" style={{ top: 0 }}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="shape s-agent" cx="20" cy="20" r="11" />
          <path className="pair-icon" d="M14.5 17 H25.5 V23.5 H14.5 Z M12.5 25.5 H27.5" />
        </svg>
        <span>
          <span className="t-ui">{t('pair.desk')}</span>
          <span className="t-cap">{desk}</span>
        </span>
      </div>
      <div className="pair-end pair-phone" style={{ top: 116 }}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="shape s-gap" cx="20" cy="20" r="11" />
          <rect className="pair-icon" x="14" y="15" width="12" height="10" rx="2" />
        </svg>
        <span>
          <span className="t-ui">{t('signedOut.browser')}</span>
          <span className="t-cap">{t('signedOut.state')}</span>
        </span>
      </div>
    </div>
  );
}

// Stands in for the app while the PC refuses this browser's reads for want of its sign-in.
export function SignedOutGate({ children }: { children: ReactNode }) {
  const app = useApp();
  const out = app.sync.signedOut === true;
  // The app stays mounted under the page, only hidden: what was being typed (a note, a capture, a
  // search) is still there when the sign-in comes back. It takes no box of its own while it shows.
  return (
    <>
      <div className="signed-out-app" style={{ display: out ? 'none' : 'contents' }}>
        {children}
      </div>
      {out ? <SignedOut onRetry={app.retry} /> : null}
    </>
  );
}

export type SignedOutProps = {
  // Reads everything again now.
  onRetry: () => void;
};

export function SignedOut({ onRetry }: SignedOutProps) {
  useLanguage();
  const [trying, setTrying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const retry = () => {
    setTrying(true);
    onRetry();
    // The answer comes as a read; if it is the same refusal the page stays and the button comes back.
    timer.current = setTimeout(() => setTrying(false), 1600);
  };
  return (
    <main className="pair-screen signed-out">
      <BrokenRoute desk={window.location.host} />
      <section className="pair-body" aria-labelledby="signed-out-title">
        <h1 id="signed-out-title" className="t-display">
          {t('signedOut.title')}
        </h1>
        <p className="t-small">{t('signedOut.text')}</p>
        <div className="so-how">
          <p>{t('signedOut.how')}</p>
          <CopyCommand command="otea open" />
          <p className="so-then">{t('signedOut.then')}</p>
          <p className="so-then">{t('signedOut.app')}</p>
        </div>
        <div className="pair-bar">
          <Button variant="primary" disabled={trying} aria-busy={trying} onClick={retry}>
            {trying ? t('signedOut.trying') : t('signedOut.retry')}
          </Button>
        </div>
      </section>
    </main>
  );
}

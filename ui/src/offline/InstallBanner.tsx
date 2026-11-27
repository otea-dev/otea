import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import {
  browserStore,
  dismissHint,
  hintDismissed,
  hintSeen,
  isStandalone,
  knownInstalled,
  noteHintSeen,
  noteInstalled,
  platformOf,
} from '../home-screen.ts';
import { type PlainKey, t } from '../i18n/i18n.ts';
import { Button } from '../kit/index.ts';
import { type InstallOffer, installOffer } from './install-offer.ts';
import { canPromptInstall, onInstallPrompt, promptInstall } from './register.ts';

// The phone's first open in the browser: a small banner, «Instalar Otea en tu inicio», over the
// tab bar. With the browser's own prompt it installs in one tap; elsewhere it gives this browser's
// steps. Dismissed once, it stays gone on this browser (Preferencias offers it again); inside the
// installed app it never shows. On iPhone it says notifications need Otea on the Home Screen.

const STEPS: Record<Exclude<InstallOffer, 'none' | 'prompt'>, PlainKey> = {
  ios: 'install.ios',
  android: 'install.android',
  other: 'install.other',
};

export type InstallBannerViewProps = {
  offer: InstallOffer;
  onInstall: () => void;
  onDismiss: () => void;
  // The install button found no browser prompt: say so above the steps.
  manual?: boolean;
  // The banner is on screen (it has a height): it shows once.
  onSeen?: () => void;
};

export function InstallBannerView({
  offer,
  onInstall,
  onDismiss,
  manual = false,
  onSeen,
}: InstallBannerViewProps) {
  const box = useRef<HTMLElement>(null);
  const shown = offer !== 'none';
  // Its height, for the page to end clear of it (phone.css pads the views by --install-h): the
  // banner lies over the foot of the page, and must never cover the last row. A page that hides it
  // (Hablar's composer, a docked move) leaves it at 0: only a banner on screen counts as shown.
  useEffect(() => {
    const el = box.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const measure = () => {
      root.style.setProperty('--install-h', `${el.offsetHeight}px`);
      if (el.offsetHeight > 0) onSeen?.();
    };
    measure();
    const seen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    seen?.observe(el);
    return () => {
      seen?.disconnect();
      root.style.removeProperty('--install-h');
    };
  }, [shown, onSeen]);
  if (!shown) return null;
  return (
    <aside ref={box} className="install-banner" aria-labelledby="install-banner-title">
      <h2 id="install-banner-title">{t('install.title')}</h2>
      {manual ? <p role="status">{t('install.manual')}</p> : null}
      <p>{offer === 'prompt' ? t('install.prompt') : t(STEPS[offer])}</p>
      {offer === 'ios' ? <p className="install-note">{t('install.iosPair')}</p> : null}
      {offer === 'ios' ? <p className="install-note">{t('install.iosPush')}</p> : null}
      {offer === 'prompt' ? null : <p className="install-note">{t('install.again')}</p>}
      <div className="install-acts">
        {offer === 'prompt' ? (
          <Button size="sm" variant="primary" onClick={onInstall}>
            {t('install.install')}
          </Button>
        ) : null}
        <Button size="sm" variant="quiet" onClick={onDismiss}>
          {offer === 'prompt' ? t('install.later') : t('home.dismiss')}
        </Button>
      </div>
    </aside>
  );
}

export function InstallBanner() {
  const app = useApp();
  // Dismissed by the person, or already on screen on an earlier load: either way it is not due.
  // What this load shows is decided once, so the banner stays while it is read.
  const [dismissed, setDismissed] = useState(
    () => hintDismissed(browserStore()) || hintSeen(browserStore()),
  );
  const noteSeen = useCallback(() => noteHintSeen(browserStore()), []);
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  const standalone = isStandalone(window.matchMedia, navigator);
  const [installed, setInstalled] = useState(() => knownInstalled(browserStore()));
  useEffect(() => onInstallPrompt(() => setCanPrompt(canPromptInstall())), []);
  // Running installed, or installed just now: the browser tab never offers it again.
  useEffect(() => {
    if (standalone) noteInstalled(browserStore());
    const done = () => {
      noteInstalled(browserStore());
      setInstalled(true);
    };
    window.addEventListener('appinstalled', done);
    return () => window.removeEventListener('appinstalled', done);
  }, [standalone]);
  // The browser had no prompt to open after all: the banner stays, with this browser's steps.
  const [byHand, setByHand] = useState(false);
  const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const offer = installOffer({
    phone: app.phone,
    standalone,
    installed,
    platform,
    canPrompt,
    dismissed,
  });
  const dismiss = () => {
    dismissHint(browserStore());
    setDismissed(true);
  };
  return (
    <InstallBannerView
      offer={offer === 'prompt' && byHand ? platform : offer}
      manual={byHand}
      onInstall={() => {
        void promptInstall().then((opened) => {
          if (opened) dismiss();
          else setByHand(true);
        });
      }}
      onDismiss={dismiss}
      onSeen={noteSeen}
    />
  );
}

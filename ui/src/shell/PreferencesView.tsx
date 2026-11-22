import { useState } from 'react';
import { useApp } from '../app/context.tsx';
import { PageSection } from '../components/PageSection.tsx';
import { focusSettings } from '../components/settings-focus.ts';
import { isStandalone } from '../home-screen.ts';
import { t } from '../i18n/i18n.ts';
import { Icon } from '../kit/Icon.tsx';
import { NotifyGroup } from '../notify/NotifyGroup.tsx';
import { InstallHint, wantsInstallLine } from '../offline/InstallHint.tsx';
import { QuickPrefs } from './Preferences.tsx';
import { prefsScope } from './prefs-model.ts';

// The Preferences page (`#/preferences`): what is yours on this browser, as against the project's
// Settings. The pop at the rail's foot holds the quick three and leads here for the rest. Sections,
// each with its heading: Appearance (the same three as the pop), Notifications (which events,
// the quiet hours, each project), Window (the desktop app's own choices), the app's install (a
// phone in its browser), the session (the way to Settings › Phone, where this browser may connect
// a phone) and About (the server). Nothing here is the project's: it is not behind a session.
export function PreferencesView({
  server = typeof window === 'undefined' ? '' : window.location.host,
}: {
  // The server this browser talks to (its host and port).
  server?: string;
}) {
  const app = useApp();
  const [standalone] = useState(
    () => typeof window !== 'undefined' && isStandalone(window.matchMedia, navigator),
  );
  return (
    <div className="page pj-settings prefs-page">
      <header className="head" data-enter="head">
        <div className="kicker">
          <b>{t('prefs.kicker')}</b> &nbsp;·&nbsp; {t(prefsScope({ phone: app.phone, standalone }))}
        </div>
        <h1 className="display">{t('prefs.title')}</h1>
        <p className="dek">{t('prefs.dek')}</p>
      </header>
      <div className="pj-body" data-enter="fade">
        <PageSection name={t('prefs.sec.appearance')}>
          <QuickPrefs />
        </PageSection>
        <NotifyGroup />
        {wantsInstallLine(app.phone) ? (
          <PageSection name={t('prefs.sec.app')} stack>
            <InstallHint />
          </PageSection>
        ) : null}
        {app.session.canManageDevices ? (
          <PageSection name={t('prefs.sec.session')} stack>
            <button
              type="button"
              className="plink"
              onClick={() => {
                focusSettings('phone');
                app.go({ view: 'settings' });
              }}
            >
              <Icon name="link" />
              {t('prefs.phone')}
            </button>
          </PageSection>
        ) : null}
        <PageSection name={t('prefs.sec.about')} stack>
          <dl className="about">
            <dt>{t('prefs.server')}</dt>
            <dd>{server}</dd>
          </dl>
        </PageSection>
      </div>
    </div>
  );
}

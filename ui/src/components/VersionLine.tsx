import { useEffect, useState } from 'react';
import { fetchServerVersion } from '../api.ts';
import { useApp } from '../app/context.tsx';
import { useRemote } from '../hooks.ts';
import { t } from '../i18n/i18n.ts';
import { desktopPrefs } from '../notify/desktop-prefs.ts';
import { deviceOf, isStale, PAGE_VERSION, report } from '../version.ts';
import { CopyGlyph } from './CopyCommand.tsx';

// Which Otea this is, as a quiet line: the version the server runs, a button that copies a short
// report for a bug (version, system, desktop app or browser), and, when this page was kept from
// before an update, a plain sentence saying so. It shows nothing until the server answers: a
// version that is not the server's would be a guess.
export function VersionLine({ page = PAGE_VERSION }: { page?: string }) {
  const app = useApp();
  const server = useRemote(fetchServerVersion, 0, app.connection);
  const desktop = useDesktopVersion();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (server.status !== 'ready') return null;
  const { value } = server;
  const copy = () =>
    navigator.clipboard
      ?.writeText(
        report({
          page,
          server: value,
          desktop,
          phone: app.phone,
          device: deviceOf(navigator),
        }),
      )
      .then(
        () => setCopied(true),
        () => {},
      );
  return (
    <div className="ver">
      <p className="ver-line">
        <span className="ver-name">Otea</span>
        <span className="ver-num">{value.version}</span>
        <button
          type="button"
          className="pj-copy ver-copy"
          data-tip={copied ? t('version.copied') : t('version.copy')}
          aria-label={t('version.copy')}
          onClick={copy}
        >
          <CopyGlyph />
        </button>
      </p>
      {isStale(page, value) ? (
        <p className="ver-stale" role="status">
          {t('version.stale', { page, server: value.version })}
        </p>
      ) : null}
    </div>
  );
}

// The desktop app's own version, when this page runs inside it; undefined in a browser, and until
// the app answers.
function useDesktopVersion(): string | undefined {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    let live = true;
    desktopPrefs()
      ?.appVersion()
      .then(
        (answer) => live && setVersion(answer),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);
  return version;
}

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import {
  addProjectPath,
  fetchProjectSettings,
  forgetProjectPath,
  relinkProjectPath,
} from '../api.ts';
import { useApp } from '../app/context.tsx';
import { type Connection, useRemote } from '../hooks.ts';
import { t, tx } from '../i18n/i18n.ts';
import { TypeIcon } from '../icons/TypeIcon.tsx';
import { Button, Icon } from '../kit/index.ts';
import { sizeLabel } from '../projects.ts';
import type { RepoSettings, ProjectSettings as Settings } from '../types.ts';
import { TopicsSetting } from '../views/topics/TopicsSetting.tsx';
import { TechDetails } from './AgentPrompt.tsx';
import { CopyGlyph } from './CopyCommand.tsx';
import { PageSection as Section } from './PageSection.tsx';
import { PhoneTransport } from './PhoneTransport.tsx';
import { settingsSectionId, takeSettingsFocus } from './settings-focus.ts';

type PathSettings = Settings['paths'][number];

function Gate({ repo }: { repo: RepoSettings }) {
  // An older Otea wrote the hook: it lets a push through when Otea cannot check it.
  if (repo.hookOutdated) {
    return (
      <span className="pj-gate">
        <span className="pj-gate-mark" data-hook="outdated">
          {t('settings.hookOutdated')}
        </span>
        <span className="t-cap">{t('settings.hookOutdatedText')}</span>
        <code className="pj-code">otea hook install --git</code>
      </span>
    );
  }
  if (repo.gate === 'hard') {
    return (
      <span className="pj-gate">
        <span className="pj-gate-mark" data-gate="hard">
          {t('settings.hard')}
        </span>
        <span className="t-cap">{t('settings.hookInstalled')}</span>
      </span>
    );
  }
  return (
    <span className="pj-gate">
      <span className="pj-gate-mark">{t('settings.soft')}</span>
      <span className="t-cap">{t('settings.instructionsOnly')}</span>
      <code className="pj-code">otea hook install --git</code>
    </span>
  );
}

// One grid for the table: the header and every row lay their cells on its columns (subgrid).
export function Repos({ repos }: { repos: RepoSettings[] }) {
  return (
    <div className="pj-repos">
      <div className="pj-repo pj-repo-head">
        <span>{t('settings.repoName')}</span>
        <span className="pj-repo-wide">{t('settings.inFolder')}</span>
        <span className="pj-repo-wide">{t('settings.gate')}</span>
        <span className="pj-repo-items">{t('settings.items')}</span>
      </div>
      {repos.map((repo) => (
        <div key={`${repo.folder}:${repo.name}`} className="pj-repo">
          <span className="pj-repo-name">
            <TypeIcon name="git-branch" size={14} />
            <span>{repo.name}</span>
          </span>
          <span className="t-cap pj-repo-wide">
            {repo.folder === '.' ? '—' : `${repo.folder}/`}
          </span>
          <span className="pj-repo-wide">
            <Gate repo={repo} />
          </span>
          <span className="t-cap pj-repo-items">
            {t('settings.itemCount', { count: repo.items })}
          </span>
        </div>
      ))}
    </div>
  );
}

type Mode = 'relink' | 'forget';

type PathCardProps = {
  path: PathSettings;
  settings: Settings;
  canWrite: boolean;
  last: boolean;
  onChanged: () => void;
};

// Runs a write and keeps its error to show beside the form.
function useWrite(onDone: () => void) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = (write: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    write().then(
      () => {
        setBusy(false);
        onDone();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  return { error, busy, run };
}

function PathCard({ path, settings, canWrite, last, onChanged }: PathCardProps) {
  const [mode, setMode] = useState<Mode>();
  const [to, setTo] = useState('');
  const write = useWrite(() => {
    setMode(undefined);
    onChanged();
  });
  const editable = canWrite && settings.registered;
  const icon = path.kind === 'folder' ? <FolderGlyph /> : <TypeIcon name="git-branch" size={16} />;
  const relink = (force: boolean) => (event?: FormEvent) => {
    event?.preventDefault();
    write.run(() => relinkProjectPath(path.path, to.trim(), force));
  };
  const different = write.error !== undefined && /same remote|not the repo/i.test(write.error);
  return (
    <div
      className="pj-path"
      data-missing={path.missing || undefined}
      data-open={mode ? true : undefined}
    >
      <div className="pj-path-head">
        <span className="pj-path-icon">{icon}</span>
        <span className="pj-path-name">{path.path}</span>
        {path.missing ? (
          <span className="pj-missing">
            <MissingMark />
            {t('settings.missing')}
          </span>
        ) : (
          <span className="pj-path-kind">
            {path.kind === 'folder' ? t('settings.folder') : t('settings.linkedRepo')}
          </span>
        )}
        {editable && mode === undefined ? (
          <span className="pj-path-actions">
            {path.missing ? (
              <Button size="sm" onClick={() => setMode('relink')}>
                {t('settings.relink')}
              </Button>
            ) : null}
            <Button size="sm" variant="quiet" onClick={() => setMode('forget')}>
              {t('settings.forget')}
            </Button>
          </span>
        ) : null}
      </div>
      {mode === 'relink' ? (
        <form className="pj-form" onSubmit={relink(false)}>
          <label className="t-label" htmlFor={`relink-${path.path}`}>
            {t('settings.newLocation', { path: path.path })}
          </label>
          <input
            id={`relink-${path.path}`}
            className="pj-input"
            value={to}
            placeholder={t('settings.pathPlaceholder')}
            spellCheck={false}
            onChange={(event) => setTo(event.target.value)}
          />
          {write.error ? <p className="action-error t-small">{write.error}</p> : null}
          <div className="pj-form-actions">
            <Button type="submit" variant="primary" disabled={write.busy || to.trim() === ''}>
              {t('settings.relinkDo')}
            </Button>
            {different ? (
              <Button disabled={write.busy} onClick={() => relink(true)()}>
                {t('settings.relinkForce')}
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => setMode(undefined)}>
              {t('common.cancel')}
            </Button>
            <span className="t-cap">{t('settings.relinkNote')}</span>
          </div>
        </form>
      ) : mode === 'forget' ? (
        <div className="pj-form">
          <p className="pj-forget">
            <b>{t('settings.forgetQuestion', { path: path.path })}</b>{' '}
            {t('settings.forgetText', { name: settings.name })}
            {last ? ` ${t('settings.forgetLast', { name: settings.name })}` : ''}
          </p>
          {write.error ? <p className="action-error t-small">{write.error}</p> : null}
          <div className="pj-form-actions">
            <Button
              disabled={write.busy}
              onClick={() => write.run(() => forgetProjectPath(path.path))}
            >
              {t('settings.forgetDo')}
            </Button>
            <Button variant="quiet" onClick={() => setMode(undefined)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : path.missing ? (
        <p className="pj-missing-text">{t('settings.missingText')}</p>
      ) : null}
    </div>
  );
}

function AddPath({ settings, onChanged }: { settings: Settings; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const write = useWrite(() => {
    setOpen(false);
    setPath('');
    onChanged();
  });
  if (!open) {
    return (
      <div className="pj-add">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          {t('settings.add')}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="pj-add pj-form"
      data-open="true"
      onSubmit={(event) => {
        event.preventDefault();
        write.run(() => addProjectPath(path.trim()));
      }}
    >
      <label className="t-label" htmlFor="add-path">
        {t('settings.addLabel', { name: settings.name })}
      </label>
      <input
        id="add-path"
        className="pj-input"
        value={path}
        placeholder={t('settings.pathPlaceholder')}
        spellCheck={false}
        onChange={(event) => setPath(event.target.value)}
      />
      {write.error ? <p className="action-error t-small">{write.error}</p> : null}
      <div className="pj-form-actions">
        <Button type="submit" variant="primary" disabled={write.busy || path.trim() === ''}>
          {t('settings.addDo')}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="quiet"
      className="pj-copy-path"
      onClick={() =>
        navigator.clipboard?.writeText(path).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        )
      }
    >
      <CopyGlyph />
      {copied ? t('settings.copied') : t('settings.copy')}
    </Button>
  );
}

function Storage({ settings }: { settings: Settings }) {
  const { database, evidence } = settings;
  return (
    <dl className="pj-storage">
      <dt>{t('settings.storage')}</dt>
      <dd>
        <span className="t-small">
          {settings.storage === 'common' ? t('settings.storageCommon') : t('settings.storageLocal')}
        </span>
      </dd>
      <dt>{t('settings.database')}</dt>
      <dd>
        <span className="pj-mono">{database.path}</span>
        <span className="t-cap">
          {sizeLabel(database.bytes)} · {t('settings.itemCount', { count: settings.items })}
        </span>
        <CopyPath path={database.path} />
      </dd>
      <dt>{t('settings.evidence')}</dt>
      <dd>
        <span className="pj-mono">{evidence.path}</span>
        <span className="t-cap">
          {sizeLabel(evidence.bytes)} · {t('common.files', { count: evidence.files })}
        </span>
        <CopyPath path={evidence.path} />
      </dd>
      <dt>{t('settings.repos')}</dt>
      <dd>
        <span className="t-small">
          {tx('settings.reposNote', {
            agents: <code className="pj-code">AGENTS.md</code>,
            hook: <code className="pj-code">pre-push</code>,
          })}
        </span>
      </dd>
    </dl>
  );
}

// Configuración without a session, at the top of the page: this computer's browser signs in with
// otea open; a paired phone or tablet never changes it. Every section below stays read-only.
export function SettingsSignIn({
  canConfigure,
  canWrite,
}: {
  canConfigure: boolean;
  canWrite: boolean;
}) {
  if (canConfigure) return null;
  return (
    <p className="pj-signin" role="note">
      <span className="pj-signin-mark" aria-hidden="true">
        <Icon name="lock" />
      </span>
      <span>
        {canWrite
          ? t('settings.deviceOnly')
          : tx('settings.signIn', { command: <code className="pj-code">otea open</code> })}
      </span>
    </p>
  );
}

// rail: the project's sidebar beside the page; sidebar: whether it is open.
type ProjectSettingsProps = {
  version: number;
  connection: Connection;
  canWrite: boolean;
};

// One project's settings: its name, the paths and repos that lead to it, and where its data lives.
// Nothing here touches the disk but the registry: relink and forget change which folders lead here.
export function ProjectSettings({ version, connection, canWrite }: ProjectSettingsProps) {
  const app = useApp();
  const [changes, setChanges] = useState(0);
  const settings = useRemote(fetchProjectSettings, version * 1000 + changes, connection);
  const changed = () => setChanges((count) => count + 1);
  const ready = settings.status === 'ready';
  // Arriving from Preferencias › Teléfono: once the sections are drawn, scroll to the one asked for.
  useEffect(() => {
    if (!ready) return;
    const section = takeSettingsFocus();
    if (section) document.getElementById(settingsSectionId(section))?.scrollIntoView();
  }, [ready]);
  const signIn = <SettingsSignIn canConfigure={canWrite} canWrite={app.session.canWrite} />;
  if (settings.status !== 'ready') {
    return (
      <div className="page pj-settings">
        {signIn}
        <p
          className={
            settings.status === 'failed' ? 'pane-message action-error' : 'pane-message t-small'
          }
        >
          {settings.status === 'failed' ? settings.message : t('common.loading')}
        </p>
      </div>
    );
  }
  const value = settings.value;
  return (
    <div className="page pj-settings">
      <header className="head" data-enter="head">
        <div className="kicker">
          <b>{t('settings.kicker')}</b> &nbsp;·&nbsp; {value.name}
        </div>
        <h1 className="display">{t('settings.display')}</h1>
        <p className="dek">{t('settings.dek', { name: value.name })}</p>
      </header>
      {signIn}
      <SettingsBody
        value={value}
        canWrite={canWrite}
        onChanged={changed}
        onPreferences={() => app.go({ view: 'preferences' })}
        you={<TopicsSetting canWrite={canWrite} />}
        phone={
          <PhoneTransport
            canWrite={canWrite}
            onPair={() => app.go({ view: 'lan', over: 'settings' })}
          />
        }
      />
    </div>
  );
}

// The sections of Configuración, in the order a person looks for them: what is theirs (Tú), the
// project (name and folders), the phone, and the technical rest behind «Avanzado». `you` and
// `phone` are the live panels that read the server themselves.
export function SettingsBody({
  value,
  canWrite,
  onChanged,
  onPreferences,
  you,
  phone,
}: {
  value: Settings;
  canWrite: boolean;
  onChanged: () => void;
  onPreferences: () => void;
  you: ReactNode;
  phone: ReactNode;
}) {
  const repos = value.paths.flatMap((path) => path.repos);
  return (
    <div className="pj-body" data-enter="fade">
      <Section
        name={t('settings.sec.you')}
        sub={t('settings.sec.youSub')}
        id={settingsSectionId('topics')}
      >
        <div className="pj-you">
          <h3 className="pj-subhead">{t('topics.settings.label')}</h3>
          {you}
          <p className="pj-hint">{t('settings.prefsText')}</p>
          <div className="pj-add pj-you-go">
            <Button size="sm" onClick={onPreferences}>
              {t('settings.prefsGo')}
            </Button>
          </div>
        </div>
      </Section>
      <Section
        name={t('settings.sec.project')}
        sub={t('settings.pathCount', { count: value.paths.length })}
      >
        <div className="pj-name">
          <span className="pj-name-icon">
            {value.paths[0]?.kind === 'folder' ? (
              <FolderGlyph />
            ) : (
              <TypeIcon name="git-branch" size={16} />
            )}
          </span>
          <span className="pj-name-value">{value.name}</span>
        </div>
        <p className="pj-hint">{t('settings.nameText')}</p>
        <h3 className="pj-subhead">{t('settings.folders')}</h3>
        <div className="pj-paths">
          {value.paths.map((path) => (
            <PathCard
              key={path.path}
              path={path}
              settings={value}
              canWrite={canWrite}
              last={value.paths.length === 1}
              onChanged={onChanged}
            />
          ))}
          {value.registered ? (
            canWrite ? (
              <AddPath settings={value} onChanged={onChanged} />
            ) : null
          ) : (
            <p className="pj-hint">{t('settings.localOneText')}</p>
          )}
        </div>
      </Section>
      <Section
        name={t('phone.transport.section')}
        sub={t('phone.transport.sub')}
        id={settingsSectionId('phone')}
      >
        {phone}
      </Section>
      <Section name={t('settings.sec.advanced')} sub={t('settings.sec.advancedSub')}>
        <TechDetails>
          <Advanced settings={value} repos={repos} canWrite={canWrite} />
        </TechDetails>
      </Section>
    </div>
  );
}

// What «Detalles técnicos» holds: the names the terminal takes, the repos and how strictly pushes
// are checked, the commands that do from a repo what the page does, and where the data lives.
function Advanced({
  settings,
  repos,
  canWrite,
}: {
  settings: Settings;
  repos: RepoSettings[];
  canWrite: boolean;
}) {
  const code = (text: string) => <code className="pj-code">{text}</code>;
  return (
    <div className="pj-adv">
      <p className="pj-hint">
        {tx('settings.nameHint', {
          join: code('--join'),
          to: code('--to'),
          id: code(settings.id),
        })}
      </p>
      {settings.registered ? (
        canWrite ? (
          <p className="pj-hint">
            {tx('settings.orInside', {
              command: code(`otea projects add . --to ${settings.name}`),
            })}
          </p>
        ) : null
      ) : (
        <p className="pj-hint">
          {tx('settings.localOne', { command: code('otea migrate --to common') })}
        </p>
      )}
      <h3 className="pj-subhead">{t('settings.repoCount', { count: repos.length })}</h3>
      {repos.length > 0 ? (
        <Repos repos={repos} />
      ) : (
        <p className="pj-hint">{t('settings.noRepos')}</p>
      )}
      <Storage settings={settings} />
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg className="pj-folder" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5 A1.5 1.5 0 0 1 5 5 H9.6 L11.6 7.2 H19 A1.5 1.5 0 0 1 20.5 8.7 V17.5 A1.5 1.5 0 0 1 19 19 H5 A1.5 1.5 0 0 1 3.5 17.5 Z" />
    </svg>
  );
}

// The incomplete node: a dashed ring, for a path Otea can't find.
function MissingMark() {
  return (
    <svg className="pj-gap" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="3.8" />
    </svg>
  );
}

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { extname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { renderUnicodeCompact } from 'uqr';
import {
  draftToStartFrom,
  proposeAgentDraft,
  proposeBoardChange,
  type Submitted,
  submitAgentDraft,
} from '../app/agent-draft.ts';
import { holdAgentHome } from '../app/agent-home.ts';
import { promptFacts, promptKindOf, roleBoard } from '../app/agent-prompts.ts';
import {
  type AgentsMdAction,
  assertPinned,
  MCP_SERVER,
  type McpEntry,
  mcpEntry,
  oldMcpEntry,
  writeAgentsMd,
} from '../app/agents.ts';
import {
  askOnBandeja,
  bandejaOfItem,
  bandejaPaths,
  entryText,
  fileBandeja,
  keepHeldEntries,
  listBandeja,
  listText,
  requireBandejaHold,
  requireEntry,
  takeBandeja,
} from '../app/bandeja.ts';
import { addBoard, addBoardSet, type BoardRecord, syncBoardPresets } from '../app/boards.ts';
import { branchNamedFirst } from '../app/branch-owner.ts';
import { briefFor } from '../app/brief.ts';
import {
  collectionIcon,
  getCollection,
  presetOf,
  setCollectionIcon,
  typeOfItem,
} from '../app/collections.ts';
import {
  conversationText,
  fromMessageLine,
  linkMessageToItem,
  messageFileAt,
  messageIdOf,
  readAsSecretary,
  requireLinkableMessage,
  sayAsSecretary,
  turnsOfItem,
} from '../app/conversation.ts';
import { cropNote } from '../app/crop.ts';
import { listDevices, revokeDevice } from '../app/devices.ts';
import { handInText, openDraftsOf } from '../app/draft-request.ts';
import { listEvents } from '../app/events.ts';
import { attachEvidence, detachEvidence, evidenceReadPath } from '../app/evidence.ts';
import { type Brings, checkGate, type GateCheck, protectedBases, type Tip } from '../app/gates.ts';
import { boardGuide, guideIndex, hintFor } from '../app/guide.ts';
import {
  forgetProjectPath,
  listProjects,
  oteaHome,
  relinkProjectPath,
  withRegistry,
} from '../app/home.ts';
import { hasOwnBoards, type InitBoard, initBoards, NO_BOARDS } from '../app/init-boards.ts';
import { itemHitsText, searchItems } from '../app/item-search.ts';
import {
  createItem,
  getItem,
  type Item,
  type ItemView,
  type ListItemsFilter,
  listItems,
  moveItem,
  oldestWaiting,
  requireItem,
  showItem,
  systemClock,
  updateItem,
} from '../app/items.ts';
import {
  keepWaitingCommand,
  keepWaitingLine,
  secretaryWaitAgainLine,
  secretaryWaitCommand,
  waitAgainLine,
} from '../app/keep-waiting.ts';
import { defaultLang, isLang } from '../app/language.ts';
import { type Launcher, oteaLauncher, runningRoot, withHome } from '../app/launcher.ts';
import type { BaseTips } from '../app/lease-take.ts';
import { claimItem, heartbeatItem, releaseItem } from '../app/leases.ts';
import { openMachine, rememberLocalProject, withMachine } from '../app/machine.ts';
import { mergeOnlyOf, mergeOnlyText, mergeRoundOf } from '../app/merge-only.ts';
import { markMerged, reopenItem } from '../app/merged.ts';
import { type MigrationReport, migrateToCommon } from '../app/migrate.ts';
import {
  approveItem,
  type BoardMoveInput,
  type BoardMoveResult,
  createdTextOf,
  dropItem,
  handoffItem,
  type Look,
  laterLine,
  liveBoardOf,
  liveBoards,
  mergeFirstFor,
  nextFor,
  offerableTo,
  offeredLine,
  rowFactsOf,
  sendBackItem,
  wokeLines,
} from '../app/next.ts';
import { agentNotes, noteWaiting, replyNote, roundNotesOf } from '../app/notes.ts';
import { overlapsOf, overlapsRecord, overlapText } from '../app/overlap.ts';
import { performanceOf } from '../app/performance.ts';
import { lanOpen, type Probe, type TransportKind } from '../app/phone.ts';
import {
  beatProcess,
  claimName,
  endListening,
  endProcess,
  endWaiter,
  endWaiting,
  forgetGoneHarness,
  type Harness,
  harnessKey,
  hearAgent,
  LISTEN_BEAT_MS,
  listAgents,
  mcpLoaded,
  type NameAdvice,
  nameFor,
  noteCall,
  noteHarness,
  offerName,
  quietVoices,
  renewLeases,
  seeAgent,
  startProcess,
  waitBeat,
} from '../app/presence.ts';
import { priorityOf } from '../app/priority.ts';
import {
  type DeclaredProfileView,
  declareProfile,
  presetProfile,
  profileCommand,
  profileReminder,
  requireProfile,
} from '../app/profile.ts';
import {
  addPathToProject,
  initProject,
  openProject,
  type Project,
  type ProjectView,
  projectView,
  setProjectIcon,
} from '../app/project.ts';
import { projectLanguage, setProjectLanguage } from '../app/project-language.ts';
import { type ProofSource, tickPoint } from '../app/proofs.ts';
import {
  answerWaiting,
  askedByAgent,
  askQuestion,
  noteChatAnswer,
  wakesWhileAsking,
} from '../app/questions.ts';
import { readerFilter } from '../app/reader-filter.ts';
import { linkItems, unlinkItems } from '../app/relations.ts';
import { relayDecision } from '../app/relay.ts';
import {
  addRepo,
  listRepos,
  type Repo,
  readReposAtFolder,
  remoteAddedLine,
  removeRepo,
  repoNameAt,
  UnknownRepo,
} from '../app/repos.ts';
import {
  ackSecretaryReturns,
  declareSecretary,
  requireSecretary,
  secretaryStatus,
  secretaryWake,
  startSecretaryWait,
} from '../app/secretary.ts';
import { startProject } from '../app/start.ts';
import type { TailscaleCli } from '../app/tailscale.ts';
import { approvedTipOf, repeatsLastRound } from '../app/tips.ts';
import {
  addTopic,
  answerTopic,
  closeTopic,
  linkTopic,
  listTopics,
  noteTopic,
  requireTopic,
  requireTopicsOn,
  setTopicsOn,
  topicsAwaiting,
  topicsAwaitingText,
  topicsGuided,
  topicsListText,
  topicsOn,
  topicText,
  topicWaiting,
} from '../app/topics.ts';
import { topicsEverywhere, topicsEverywhereText } from '../app/topics-everywhere.ts';
import { validateProject } from '../app/validate.ts';
import { type Watched, type WatchOptions, watch } from '../app/watch.ts';
import { agentGuideFor, TOPICS_REMINDER, TOPICS_RULE } from '../core/agent-guide.ts';
import {
  agentPrompt,
  isPromptKind,
  isRole,
  PROMPT_KINDS,
  type PromptKind,
  ROLES,
  type Role,
  type RoleFacts,
  rolePrompt,
  roleTakesBoard,
} from '../core/agent-prompts.ts';
import { bandejaIdOf, isBandejaRef } from '../core/bandeja.ts';
import { isClosed, isLandStep, positionOf, waysOf } from '../core/board/engine.ts';
import {
  type BoardDefinition,
  DONE,
  guardedBranch,
  isEvidence,
  stepById,
  stepIndex,
  workedBase,
} from '../core/board/model.ts';
import { DROPPED_NAME, wayByName } from '../core/board/next.ts';
import { attachedPart, fieldsByName, partByName, stateName } from '../core/board/reading.ts';
import type { Lang } from '../core/board/template-words.ts';
import { isSetKey, LANGS, LISTED_KEYS, TEMPLATE_SETS, TEMPLATES } from '../core/board/templates.ts';
import { parseDiagram } from '../core/diagram.ts';
import { OteaError } from '../core/errors.ts';
import { EVIDENCE_ROLES, type EvidenceRole, MAX_EVIDENCE_MB } from '../core/evidence.ts';
import type { FieldValues } from '../core/fields.ts';
import { assertIconName } from '../core/icons.ts';
import { type Actor, assertAgentName } from '../core/item.ts';
import { parseDuration, parseWaitTimeout } from '../core/lease.ts';
import { profileLine, UNKNOWN } from '../core/profile.ts';
import { describeRelation, RELATION_KINDS } from '../core/relations.ts';
import { AGENT_ROLES, ROLE_ABOUT } from '../core/secretary.ts';
import { timeText } from '../core/time.ts';
import { TURNS, type Turn } from '../core/workflow.ts';
import { DEFAULT_PORT } from '../server/hosts.ts';
import { machineProjects, type ServedProject } from '../server/hub.ts';
import { formatCode } from '../server/lan.ts';
import { ensureVapidKeys } from '../server/push.ts';
import {
  issueSignInLink,
  redeemSignInLink,
  SIGNIN_LINK_LIFETIME_MS,
} from '../server/signin-links.ts';
import { ensureUiToken, readUiToken } from '../server/token.ts';
import {
  type EventFilter,
  findAgent,
  findProfile,
  forgetAgent,
  markMcpAsked,
  type ProfileView,
  profileView,
  selectListenerProcesses,
  selectMcpLoads,
} from '../store/queries.ts';
import { baseStray } from './base-strays.ts';
import {
  type Command,
  CommandFailure,
  failureCode,
  type Input,
  type Output,
  UsageError,
} from './command.ts';
import {
  ensureServer,
  forgetStale,
  inspectServer,
  type Launch,
  SERVE_LOG,
  type ServerState,
  stopServer,
  unresponsiveText,
} from './daemon.ts';
import { installForge, removeForge } from './forge.ts';
import {
  columns,
  formatEvent,
  formatEvidence,
  formatItem,
  formatItems,
  formatItemWithEvents,
  formatReport,
  indent,
} from './format.ts';
import { prState } from './gh.ts';
import {
  branchCheckedOutAnywhere,
  branchesBrought,
  checkedOutBranch,
  checkoutRoot,
  commitsOver,
  currentBranch,
  hasCommit,
  inMainCheckout,
  landedIn,
  mergeTake,
  pushState,
  remoteOf,
  rewritesRemote,
  tipOf,
} from './gitrepo.ts';
import {
  gitHookOf,
  type HookChange,
  installGitHook,
  outdatedGitHookLine,
  refreshOutdatedGitHook,
  removeClaudeHook,
  removeGitHook,
} from './hooks.ts';
import { baseTipsOf, landedCommitRefusal } from './landed-commit.ts';
import { type LocalBehind, localBehindOf, localBehindText } from './local-behind.ts';
import { mergedOutside, mergedOutsideLine } from './merged-outside.ts';
import { boardsOf, eventData, itemCollections, itemData, readableEvent } from './names.ts';
import { watchOwner } from './owner.ts';
import { PHONE_COMMANDS } from './phone.ts';
import { portFrom, portToOpen, portToStart, projectPage } from './ports.ts';
import { probeSignIn } from './probe.ts';
import { readServeFile, removeServeFile, serverVersionNote, writeServeFile } from './serve-file.ts';
import {
  boardHintLines,
  cancelled,
  choiceFrom,
  choiceQuestion,
  defaultBoard,
} from './start-choice.ts';
import { statsText } from './stats.ts';
import {
  dataTargets,
  purgeData,
  type RepoReport,
  type Step,
  uninstallRepos,
  uninstallServer,
} from './uninstall.ts';
import { OTEA_VERSION } from './version.ts';

// The text names an item's type only when its collection's preset has several.
function typesShown(project: Project): (item: { collection: string }) => boolean {
  const several = new Map<string, boolean>();
  return ({ collection }) => {
    const known = several.get(collection);
    if (known !== undefined) return known;
    const shown = presetOf(project, getCollection(project.db, collection)).types.length > 1;
    several.set(collection, shown);
    return shown;
  };
}

function itemResult(project: Project, item: Item): Output {
  return {
    data: itemData(project, item),
    text: formatItem(readable(project, item), typesShown(project)),
  };
}

// An item on a board as its reader says it: its step by name, its fields and choices by name, its
// moves and events by step names. Hidden ids stay in --json, as the keys a program reads.
function readable<T extends Item>(project: Project, raw: T): T {
  // Each related item's step by name, on its own board.
  const related = (raw as unknown as Partial<ItemView>).relations;
  const item = (
    related
      ? {
          ...raw,
          relations: related.map((r) => {
            // A list's relations are bare refs (no collection or state): nothing to name.
            const { collection, state } = r as { collection?: unknown; state?: unknown };
            if (typeof collection !== 'string' || typeof state !== 'string') return r;
            const on = liveBoardOf(project, collection);
            return on ? { ...r, state: stateName(on.def, state) } : r;
          }),
        }
      : raw
  ) as T;
  const board = liveBoardOf(project, item.collection);
  if (!board) return item;
  const { def } = board;
  const named = (state: unknown) => stateName(def, String(state));
  const out: Record<string, unknown> = {
    ...item,
    state: named(item.state),
    fields: fieldsByName(def, item.fields),
  };
  const view = item as unknown as Partial<ItemView>;
  // A drop with each motive is a state of its own, all named Dropped: said once, with the motives.
  const motives = def.drop.motives.map(({ name }) => name);
  const moves = (list: ItemView['transitions']) => {
    const said = new Map<string, ItemView['transitions'][number] & { motives?: string[] }>();
    for (const move of list) {
      const to = named(move.to);
      if (said.has(to)) continue;
      const drop = to === DROPPED_NAME && motives.length > 0;
      said.set(to, { ...move, to, ...(drop ? { motives } : {}) });
    }
    return [...said.values()];
  };
  const partName = (ref: unknown) => def.parts[String(ref)]?.name ?? String(ref);
  if (view.transitions) out.transitions = moves(view.transitions);
  if (view.relayable) out.relayable = moves(view.relayable);
  if (view.missing) out.missing = view.missing.map(partName);
  if (view.evidence)
    out.evidence = view.evidence.map((entry) =>
      entry.module === null ? entry : { ...entry, module: partName(entry.module) },
    );
  if (view.events) out.events = view.events.map((event) => readableEvent(def, event));
  return out as T;
}

function withProject<T>(cwd: string, use: (project: Project) => T): T {
  const project = openProject(cwd);
  try {
    return use(project);
  } finally {
    project.db.close();
  }
}

async function withProjectWhile<T>(cwd: string, use: (project: Project) => Promise<T>): Promise<T> {
  const project = openProject(cwd);
  try {
    return await use(project);
  } finally {
    project.db.close();
  }
}

// Notes that the agent running the command was seen, so the UI can show who is at work.
function seen(project: Project, input: Input, actor: Actor = input.actor): void {
  const { channel, harness, newSession } = input;
  if (actor.kind !== 'agent') return;
  // Through an MCP server the agent is connected: the open server is listening for it.
  const note = channel === 'mcp' ? hearAgent : seeAgent;
  note(project.db, {
    agent: actor.name,
    channel,
    harness,
    folder: input.cwd,
    ...(newSession ? { newSession } : {}),
    call: true,
  });
  // A command-line agent speaking after the harness session noted for it ended is another session.
  if (channel === 'cli') forgetGoneHarness(project.db, actor.name);
  // Any call of it keeps what it holds (P1-R3-6).
  renewLeases(project.db, actor.name);
  keepHeldEntries(project, actor.name);
  // The secretary acting on what its wait returned: any command but another secretary wait.
  if (input.command !== undefined && !(input.command === 'wait' && input.flag('secretary'))) {
    ackSecretaryReturns(project.db, actor.name);
  }
}

// Runs a command seen as `actor`: noted first, so the command finds it, and forgotten again when it
// was never seen before and the command fails (P2S-R2-3): a failed command is no agent at work, the
// desk would list it «sin perfil», and whoami would hand its name out.
function seenWhile<T>(
  project: Project,
  input: Input,
  actor: Actor,
  run: () => T,
  mode: 'write' | 'read' = 'write',
): T {
  // An agent at work in another project is refused here, before it is noted or writes anything; a
  // command that only reads goes on, with the agent not noted as seen in this project.
  if (actor.kind === 'agent' && !holdAgentHome(project, actor.name, mode)) return run();
  const fresh = actor.kind === 'agent' && !findAgent(project.db, actor.name);
  seen(project, input, actor);
  if (!fresh) return run();
  const forget = (error: unknown): never => {
    forgetAgent(project.db, actor.name);
    throw error;
  };
  try {
    const result = run();
    return (result instanceof Promise ? result.catch(forget) : result) as T;
  } catch (error) {
    return forget(error);
  }
}

// Opens the project for a command an agent runs, noting the agent as seen first.
// An agent's write: refused when the agent is pinned to another project (otea connect).
function withAgent<T>(input: Input, use: (project: Project) => T): T {
  return withProject(input.cwd, (project) => {
    assertPinned(input.pin, project.identity);
    return seenWhile(project, input, input.actor, () => use(project));
  });
}

// Opens the project for a command that only reads: an agent that gave its name is seen; the person
// reading without one is not.
function withReader<T>(input: Input, use: (project: Project) => T): T {
  return withProject(input.cwd, (project) =>
    seenWhile(project, input, input.reader, () => use(project), 'read'),
  );
}

async function withReaderWhile<T>(input: Input, use: (project: Project) => Promise<T>): Promise<T> {
  return withProjectWhile(input.cwd, (project) =>
    seenWhile(project, input, input.reader, () => use(project), 'read'),
  );
}

async function withAgentWhile<T>(input: Input, use: (project: Project) => Promise<T>): Promise<T> {
  return withProjectWhile(input.cwd, (project) => {
    assertPinned(input.pin, project.identity);
    return seenWhile(project, input, input.actor, () => use(project));
  });
}

const AGENTS_MD_TEXT: Readonly<Record<AgentsMdAction, (path: string) => string>> = {
  created: (path) => `Added the Otea block to ${path}`,
  added: (path) => `Added the Otea block to ${path}`,
  updated: (path) => `Updated the Otea block in ${path}`,
  unchanged: (path) => `The Otea block in ${path} is up to date`,
};

function boardsText(boards: readonly InitBoard[]): string {
  return `Made the boards ${boards.map(({ name }) => name).join(', ')}`;
}

// Which language a command with no desk in front of the person makes things in: the project's, fixed
// when it was made (app/project-language.ts), by the rule of app/language.ts.
const LANGUAGE_RULE =
  "the project's language, set when the project was made: the one the desk last used then, else the first of the locale variables LC_ALL and LC_MESSAGES that is set (C and POSIX say nothing), else this computer's language, else LANG, else English; otea projects lang changes it";

// The templates the CLI takes, the same Studio's home offers, as its help lists them.
const TEMPLATE_KEYS = LISTED_KEYS.join(', ');

const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;

// Each template key with what it makes, for the help of the commands that take one.
const TEMPLATE_LIST = (() => {
  const width = Math.max(...LISTED_KEYS.map((key) => key.length)) + 2;
  const lines = LISTED_KEYS.map((key) => {
    const set = TEMPLATE_SETS.find((candidate) => candidate.key === key);
    const template = set ?? TEMPLATES.find((candidate) => candidate.key === key);
    if (!template) return `  ${key}`;
    const name = set ? `${template.name.en} (a set): ` : '';
    return `  ${key.padEnd(width)}${name}${firstSentence(template.description.en)}`;
  });
  return ['Templates (--template <key>):', ...lines].join('\n');
})();

// What init says to do next: the person opens the desk, in a terminal of their own or the desktop
// app, which hands them the text for their agent's chat; an agent setting the project up connects
// itself and never starts the desk, which would close with its session (P4-R3-9).
export const INIT_NEXT = [
  "Next: run otea serve in a terminal of your own, or open the Otea desktop app: the desk gives you the text to paste into your agent's chat (otea prompt prints it here).",
  'An agent setting itself up runs otea connect --as <name> --model <id> --effort <level>; it never starts the desk for the person (if it must, otea serve --no-open).',
];

// The same, while this computer's desk already runs (otea start, or the desktop app, did it): it
// says so instead of telling to start a second one (P9-F3).
export const initNext = (deskUrl: string | undefined): string[] =>
  deskUrl === undefined
    ? INIT_NEXT
    : [
        `Next: the desk already runs at ${deskUrl}, so there is nothing to start: it gives you the text to paste into your agent's chat (otea prompt prints it here).`,
        ...INIT_NEXT.slice(1),
      ];

// The address of this computer's running desk, when one does.
async function runningDesk(): Promise<string | undefined> {
  const state = await inspectServer(oteaHome());
  return state.kind === 'running' ? state.url : undefined;
}

const init: Command = {
  name: 'init',
  summary: `Create or reuse the project at the repository root: in the Otea home ($OTEA_HOME, default ~/.otea), or with --local in .otea at the root; --join <project> links the repo to a registered project instead (refused when a project in a folder above covers it, unless --here); it makes no board unless --template <key> names one, and only on a project with no boards of its own yet: the boards of that template (${TEMPLATE_KEYS}; a set such as ideas or repos makes all of its boards); you can also pick them later in Studio or with otea board add <name> --template <key>; its boards and its Pedidos board are made in the language you use (the desk's, else this computer's, else English), which becomes the project's language (otea projects lang changes it); --icon gives the project an icon (without one the UI draws a monogram of its name); --agents-md also adds (or refreshes) a block in AGENTS.md telling agents to run "otea next" and "otea board"`,
  details: TEMPLATE_LIST,
  args: [],
  options: {
    'agents-md': { flag: true },
    here: { flag: true },
    local: { flag: true },
    join: { placeholder: 'project' },
    template: { placeholder: 'key' },
    icon: { placeholder: 'icon' },
  },
  execute: async ({ cwd, flag, option }) => {
    const target = option('join');
    const template = option('template');
    const icon = option('icon');
    if (icon !== undefined) assertIconName(icon);
    if (target !== undefined && (flag('local') || flag('here') || template !== undefined)) {
      throw new UsageError(
        '--join links to an existing project; it takes no --local, --here or --template',
      );
    }
    const options = {
      here: flag('here'),
      local: flag('local'),
      ...(target === undefined ? {} : { join: target }),
    };
    const project = initProject(cwd, options);
    const { root, dataDir: path, storage } = project;
    let made: InitBoard[] = [];
    let shown: ProjectView;
    let kept = false;
    try {
      shown = icon === undefined ? projectView(project) : setProjectIcon(project, icon);
      // The repos at the project's folders are added now, before any clone of them is linked.
      if (target === undefined) {
        kept = template !== undefined && template !== NO_BOARDS && hasOwnBoards(project);
        made = initBoards(project, template, projectLanguage(project));
        listRepos(project);
      } else readReposAtFolder(project, root);
    } finally {
      project.db.close();
    }
    const data = { root, path, ...shown, storage, boards: made };
    const lines = [
      ...(target === undefined
        ? []
        : [`Linked ${root} to the project ${shown.name} (${shown.id})`]),
      `Project data in ${path}`,
      ...(made.length > 0 ? [boardsText(made)] : []),
      ...(kept
        ? [
            `The project already has boards; add one with otea board add <name> --template ${template}`,
          ]
        : []),
    ];
    const next = initNext(await runningDesk());
    if (!flag('agents-md')) return { data, text: [...lines, ...next].join('\n') };
    const agentsMd = writeAgentsMd(root);
    const text = [...lines, AGENTS_MD_TEXT[agentsMd.action](agentsMd.path), ...next];
    return { data: { ...data, agentsMd }, text: text.join('\n') };
  },
};

const projectsList: Command = {
  name: 'projects list',
  summary: 'List the registered projects (common storage) with the folders linked to each',
  args: [],
  options: {},
  execute: () => {
    const projects = withRegistry(process.env, listProjects) ?? [];
    const text = projects
      .map(({ id, name, storage, paths }) =>
        [
          `${id}  ${name}  ${storage}`,
          ...paths.map(
            ({ path, kind, missing }) => `  ${path}  ${kind}${missing ? '  (missing)' : ''}`,
          ),
        ].join('\n'),
      )
      .join('\n');
    return { data: projects, text: text || 'No registered projects' };
  },
};

const projectsCurrent: Command = {
  name: 'projects current',
  summary:
    'Show the project this folder resolves to: id, name, storage, folder, data folder and the Otea home whose server serves it',
  args: [],
  options: {},
  execute: ({ cwd }) => {
    const data = withProject(cwd, ({ identity, storage, root, dataDir }) => ({
      ...identity,
      storage,
      root,
      dataDir,
      home: oteaHome(),
    }));
    return {
      data,
      text: `${data.id}  ${data.name}  ${data.storage}\n${data.root}\n${data.dataDir}`,
    };
  },
};

const projectsLang: Command = {
  name: 'projects lang',
  summary:
    "Show the project's language, or change it with en or es: the language of what Otea makes for the project with no desk to ask (otea start, prompt, board add, board draft, a Pedido's title). It affects only what is made from then on; boards that exist keep their words, and the desk keeps its own language for its screen",
  args: ['lang?'],
  options: {},
  execute: ({ cwd, args: [asked], agent }) => {
    // The project's language is the person's choice: an agent that names itself only reads it.
    if (asked !== undefined && agent !== undefined) {
      throw new OteaError(
        'forbidden',
        `otea projects lang ${asked} changes the project's language, which is the person's choice. An agent reads it with otea projects lang, and asks the person with otea ask <id> "<question>" --as ${agent}`,
      );
    }
    if (asked !== undefined && !isLang(asked)) throw new UsageError('The language is en or es');
    return withProject(cwd, (project) => {
      const lang =
        asked === undefined ? projectLanguage(project) : setProjectLanguage(project, asked);
      const said = lang === 'es' ? 'Spanish' : 'English';
      return {
        data: { lang },
        text:
          asked === undefined
            ? `${said} (${lang})`
            : `The project's language is now ${said} (${lang}); what exists keeps its words`,
      };
    });
  },
};

const projectsAdd: Command = {
  name: 'projects add',
  summary:
    'Link a folder (another repo, say) to a registered project, so commands run in it use that project',
  args: ['path'],
  options: { to: { required: true, placeholder: 'project' } },
  execute: ({ cwd, required, args: [path = ''] }) => {
    const linked = addPathToProject(resolve(cwd, path), required('to'));
    const repos = withProject(linked.path, (project) => readReposAtFolder(project, linked.path));
    const text = [`Linked ${linked.path} to ${linked.projectId}`, ...reposAddedText(repos)];
    return { data: { ...linked, repos }, text: text.join('\n') };
  },
};

function reposAddedText(repos: readonly Repo[]): string[] {
  if (repos.length === 0) return [];
  return [
    `Added the repo${repos.length === 1 ? '' : 's'} ${repos.map(({ name }) => name).join(', ')}`,
  ];
}

const reposList: Command = {
  name: 'repos list',
  summary:
    "List the project's repos: the name its items give each one (a repo task's repo field) and what tells it apart wherever it is cloned (its origin URL, or its root commit without one)",
  args: [],
  options: {},
  execute: ({ cwd }) => {
    const repos = withProject(cwd, (project) => listRepos(project));
    const text = repos.map(({ name, identity }) => `${name}  ${identity}`).join('\n');
    return { data: repos, text: text || 'No repos' };
  },
};

const reposAdd: Command = {
  name: 'repos add',
  summary:
    'Add the repo at a folder (default: here) to the project, under --name or its folder name; a repo already added is renamed by --name. Every clone of it, in any folder, goes by that name in gate checks',
  args: ['path?'],
  options: { name: { placeholder: 'name' } },
  execute: ({ cwd, option, args: [path = '.'] }) => {
    const repo = withProject(cwd, (project) =>
      addRepo(project, resolve(cwd, path), option('name')),
    );
    return { data: repo, text: `${repo.name}  ${repo.identity}` };
  },
};

const reposRemove: Command = {
  name: 'repos remove',
  summary:
    'Remove a repo from the project by name; its items keep their values, and gate checks refuse in it until it is added again',
  args: ['name'],
  options: {},
  execute: ({ cwd, args: [name = ''] }) => {
    const repo = withProject(cwd, (project) => removeRepo(project, name));
    return { data: repo, text: `Removed ${repo.name}` };
  },
};

function inRegistry<T>(use: (registry: DatabaseSync) => T): T {
  const result = withRegistry(process.env, use);
  if (result === undefined) throw new OteaError('not_found', 'No project is registered yet');
  return result;
}

const projectsRelink: Command = {
  name: 'projects relink',
  summary:
    'Point a linked folder at where its repo moved; refused unless the new folder has the same remote URL or root commit (--force links it anyway)',
  args: ['old', 'new'],
  options: { force: { flag: true } },
  execute: ({ cwd, flag, warn, args: [from = '', to = ''] }) => {
    const relinked = inRegistry((registry) =>
      relinkProjectPath(registry, resolve(cwd, from), resolve(cwd, to), flag('force')),
    );
    if (relinked.match === 'unknown') {
      warn(`Could not check that ${relinked.link.path} is the same repo (no remote URL or commit)`);
    }
    const text = `Relinked ${relinked.from} to ${relinked.link.path} (${relinked.link.projectId})`;
    return { data: relinked, text };
  },
};

const projectsForget: Command = {
  name: 'projects forget',
  summary:
    'Unlink a folder from its project; the project and its items stay, and with no folder left nothing resolves to it',
  args: ['path'],
  options: {},
  execute: ({ cwd, args: [path = ''] }) => {
    const forgotten = inRegistry((registry) => forgetProjectPath(registry, resolve(cwd, path)));
    const { link, remaining } = forgotten;
    const left =
      remaining === 0
        ? `${link.projectId} has no linked folder left; its data stays, link one with otea projects add`
        : `${link.projectId} keeps ${remaining} linked folder${remaining === 1 ? '' : 's'}`;
    return { data: forgotten, text: `Forgot ${link.path}\n${left}` };
  },
};

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function migrationText(report: MigrationReport): string {
  const { status, id, root, to, from, backup, tables, files, undo } = report;
  if (status === 'already') return `${id} is already in common storage at ${to}; nothing to do`;
  const rows = Object.entries(tables)
    .map(([table, { rows }]) => `${table} ${rows}`)
    .join(', ');
  const lines =
    status === 'migrated'
      ? [
          `Copied and verified the database into ${to} (${rows})`,
          `Copied ${files} evidence and preset file${files === 1 ? '' : 's'}`,
          `Registered ${id} and linked ${root}`,
        ]
      : [`${id} was already copied to ${to} and registered`];
  return [
    ...lines,
    `Moved ${from} to ${backup} (a backup: Otea never deletes it)`,
    'To undo:',
    ...undo.map((step) => `  ${step}`),
  ].join('\n');
}

const migrateCommand: Command = {
  name: 'migrate',
  summary:
    'Move the local project (.otea/) into common storage in the Otea home, verified, keeping the old folder as a backup; refused while otea serve runs on this computer',
  args: [],
  options: { to: { required: true, choices: ['common'] } },
  execute: ({ cwd, required }) => {
    required('to');
    withProject(cwd, () => undefined);
    const server = readServeFile(oteaHome());
    if (server && processAlive(server.pid)) {
      throw new OteaError(
        'in_use',
        `otea serve (pid ${server.pid}, port ${server.port}) holds the project's database; stop it first (otea serve stop)`,
      );
    }
    const report = migrateToCommon(cwd);
    return { data: report, text: migrationText(report) };
  },
};

// How what Otea writes (hooks, the MCP server connect prints) runs this Otea again: Node on
// main.ts in a checkout, main.js in the published package; the desktop app on its own
// Electron. connect prefers the otea command on $PATH when it is this same install.
const OTEA_MAIN = fileURLToPath(new URL(`./main${extname(import.meta.url)}`, import.meta.url));
const OTEA = oteaLauncher(OTEA_MAIN, {
  execPath: process.execPath,
  electron: process.versions.electron,
});

// The MCP server as an agent adds it to its own harness's config: every harness keeps that config
// its own way, so Otea gives one instruction and writes none of them.
function mcpInstructionText(entry: McpEntry): string[] {
  const env = Object.entries(entry.env ?? {}).map(([name, value]) => `${name}=${value}`);
  const json = JSON.stringify({ [MCP_SERVER]: entry });
  return [
    "To use Otea's MCP tools, add this MCP server to your harness's MCP config yourself, for this project only (its own config file or your harness's project scope, never your user or global config: the server is pinned to this project). It is a local stdio server, and Otea writes no harness config:",
    indent(
      columns([
        ['name', MCP_SERVER],
        ['command', entry.command],
        ['args', entry.args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')],
        ...(env.length > 0 ? [['env', env.join(' ')]] : []),
      ]),
    ),
    `As JSON: ${json}`,
    "That JSON is one shape, and a harness may skip a server in another shape without a word: translate it to your harness's schema, or use its own mcp add command, at project scope. Examples: Claude Code: .mcp.json (under mcpServers); OpenCode: opencode.json (under mcp.servers, with type local, command as one array of the command and its args, and env as environment); Codex: .codex/config.toml (a [mcp_servers.<name>] table); Gemini CLI: .gemini/settings.json (under mcpServers). The README has each in full.",
    "The entry names no agent: each session names itself (--as; MCP tools: as). If your harness already has a server named otea that runs anything else (an older Otea, or mcp --as <name>), replace it for this project with this one. If your harness must restart or reload to load the server, ask the person for it now, before you go on, and to reopen this same conversation with your harness's resume option, if it has one, so you keep what was said; Otea keeps every item and board draft either way. Approve it if your harness asks, then call any Otea tool. Until then, and whenever MCP is off, the otea command does the same.",
    'Then run otea connect --check (with --as <name>), and again after that call: only it tells whether the server loaded, and the desk warns until it does.',
  ];
}

// The MCP server entry for a project, as connect and start print it. The otea on PATH only when
// it is this same install: another one would run other code.
function mcpEntryFor(input: Pick<Input, 'oteaOnPath' | 'home'>, id: string) {
  const onPath = input.oteaOnPath?.();
  const running = runningRoot(OTEA_MAIN);
  const same = (a: string, b: string) =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const usePath = onPath?.root !== undefined && running !== undefined && same(onPath.root, running);
  const entry = mcpEntry(withHome(usePath && onPath ? onPath.launcher : OTEA, input.home), id);
  return { entry, usePath, onPath };
}

// What an agent's harness must let it run for Otea's flow, said the same for every harness: Otea
// writes no harness config, and the docs give an example per harness.
const HARNESS_PERMISSIONS =
  "Have your harness allow, for this project: otea (its commands and its MCP tools), git push to the items' branches (Otea's pre-push hook still checks each push) and git worktree add (docs/working-with-agents.md, «What your harness must allow», has examples).";

// An outdated pre-push hook that is exactly one an Otea wrote is updated by whichever command sees
// it first, so the warning does not come back on every command and push (P10-F2): the rule is the
// one hook remove follows, a file that is exactly Otea's and nothing else.
function refreshedHookLine({ cwd, home }: Pick<Input, 'cwd' | 'home'>): string | undefined {
  const path = refreshOutdatedGitHook(cwd, withHome(OTEA, home));
  return path === undefined
    ? undefined
    : `Updated ${path}, a pre-push hook an older Otea wrote, to this version: a push now stops when Otea cannot check it (otea hook remove --git takes it out)`;
}

// What otea connect --check says: whether the agent named (or any agent) was heard through Otea's
// MCP server in this project.
function mcpCheck(project: Project, agent: string | undefined, now = systemClock): Output {
  const agents = listAgents(project.db, now);
  const heard = agents
    .filter(({ name, mcpAt }) => mcpAt !== null && (agent === undefined || name === agent))
    .sort((a, b) => Date.parse(b.mcpAt ?? '') - Date.parse(a.mcpAt ?? ''));
  // The harnesses that loaded the server: the agent's own (as its client or its profile names
  // it), or any without --as.
  const mine = agents.find(({ name }) => name === agent);
  const named = [mine?.harness, mine?.profile?.harness].filter(
    (each): each is string => Boolean(each) && each?.toLowerCase() !== 'cli',
  );
  const loads = selectMcpLoads(project.db).filter(
    ({ harness }) => agent === undefined || named.some((each) => harnessKey(each) === harness),
  );
  const data = {
    connected: heard.length > 0 || loads.length > 0,
    agents: heard.map(({ name, harness, mcpAt }) => ({ name, harness, mcpAt })),
    loaded: loads.map(({ name, at }) => ({ harness: name, at })),
  };
  if (heard.length > 0) {
    const lines = heard.map(
      ({ name, harness, mcpAt }) =>
        `MCP works: ${name} was heard through Otea's MCP server ${timeText(mcpAt ?? '')}${harness ? ` (${harness})` : ''}`,
    );
    return { data, text: lines.join('\n') };
  }
  // Loaded, and no tool called through it yet: the agent may keep to the otea command, which does
  // the same (P4-R2-10).
  if (loads.length > 0) {
    const lines = loads.map(
      ({ name, at }) =>
        `MCP works: ${name} loaded Otea's MCP server ${timeText(at)}; no agent has called its tools yet. The otea command does the same, so the agent may use either.`,
    );
    return { data, text: lines.join('\n') };
  }
  const who = agent ? `${agent} has not reached` : 'No agent has reached';
  return {
    data,
    text: `${who} Otea through its MCP server in this project yet. If you added the server, restart or reload the session and approve it when your harness asks (declining turns it off for the project), then call any Otea tool, such as next. If Otea tools answer you but this still says so, your harness runs another otea server (an older one, or one started with --as): replace it for this project with the one otea connect prints. Meanwhile the otea command works the same.`,
    failure: 'not_connected',
  };
}

const connect: Command = {
  name: 'connect',
  summary:
    "Connect agents to Otea, the same for every harness: add (or refresh) Otea's block in AGENTS.md and print the MCP server an agent adds to its own harness's config (otea mcp --project <id>: Otea writes no harness config). --as also declares the profile that agent runs as (--model and --effort, --harness; one it is not given stays as declared, else unknown), and notes it asked for MCP, so the desk warns while its harness never loads the server. --check says whether the agent (--as) or any agent was heard through the MCP server. --cli (or --no-mcp) is for an agent that works from the command line only: it prints no MCP server, only a short note",
  args: [],
  // --as is a global option; it is named here so the usage line shows it.
  options: {
    as: { placeholder: 'name' },
    model: { placeholder: 'id' },
    effort: { placeholder: 'level' },
    harness: { placeholder: 'name' },
    role: { choices: AGENT_ROLES, about: ROLE_ABOUT },
    check: { flag: true },
    cli: { flag: true },
    'no-mcp': { flag: true },
  },
  execute: async (input) => {
    const { cwd, option, flag } = input;
    const name = input.agent;
    if (name !== undefined) assertAgentName(name);
    const role = option('role');
    if (role !== undefined && (name === undefined || flag('check'))) {
      throw new UsageError('--role names the role of the agent given with --as, and is no check');
    }
    if (flag('check')) {
      const checked = withProject(cwd, (project) => mcpCheck(project, name));
      const refreshed = refreshedHookLine(input);
      const withRefresh =
        refreshed === undefined
          ? checked
          : {
              ...checked,
              data: { ...(checked.data as object), refreshedGitHook: refreshed },
              text: `${checked.text}\n${refreshed}`,
            };
      const outdated = outdatedGitHookLine(cwd);
      if (outdated === undefined) return withRefresh;
      return {
        ...withRefresh,
        data: { ...(withRefresh.data as object), outdatedGitHook: outdated },
        text: `${withRefresh.text}\n${outdated}`,
      };
    }
    const model = option('model');
    const effort = option('effort');
    const cliOnly = flag('cli') || flag('no-mcp');
    const { root, id } = withProject(cwd, (project) => {
      if (name !== undefined) {
        // A model or an effort it is not given stays what the agent declared, else unknown: some
        // harnesses tell the agent neither, and it declares it itself in its first session (P8-F3).
        const known = findProfile(project.db, name);
        const harness = option('harness');
        if (model !== undefined || effort !== undefined || harness !== undefined || !known) {
          presetProfile(project.db, {
            agent: name,
            model: model ?? known?.profile.model ?? UNKNOWN,
            effort: effort ?? known?.profile.effort ?? UNKNOWN,
            given: harness,
          });
        }
        // An agent on the command line only asked for no MCP: the desk has nothing to warn about.
        if (!cliOnly) markMcpAsked(project.db, name, systemClock());
        // The one secretary of the project: refused while another is connected.
        if (role !== undefined) declareSecretary(project.db, name);
      }
      return { root: project.root, id: project.identity.id };
    });
    // AGENTS.md goes in the checkout the agent works in: a linked worktree's own, so its agents
    // read it there.
    const here = checkoutRoot(cwd) ?? root;
    const agentsMd = writeAgentsMd(here);
    const agentsLine = `${AGENTS_MD_TEXT[agentsMd.action](agentsMd.path)}: every agent that reads AGENTS.md finds Otea there`;
    if (cliOnly) {
      const as = name ?? '<name>';
      return {
        data: { agentsMd, ...(name === undefined ? {} : { agent: name }) },
        text: [
          agentsLine,
          HARNESS_PERMISSIONS,
          `You work from the command line, with no MCP server. Start with otea board, then otea next --as ${as}; run otea connect without --cli for the MCP server entry instead.`,
        ].join('\n'),
      };
    }
    const { entry, usePath, onPath } = mcpEntryFor(input, id);
    const mcp = { name: MCP_SERVER, ...entry };
    const old = oldMcpEntry(here);
    const text = [
      `${AGENTS_MD_TEXT[agentsMd.action](agentsMd.path)}: every agent that reads AGENTS.md finds Otea there (if your harness doesn't read AGENTS.md, import it from the file it reads)`,
      // The one file connect writes in the repo: said each time it changes it, with the way back.
      ...(agentsMd.action === 'unchanged'
        ? []
        : [
            `${agentsMd.path} is the only file otea connect writes in your repo: the block between <!-- otea:begin --> and <!-- otea:end -->, which only points to otea board. otea uninstall takes it out.`,
          ]),
      // A harness's permission mode blocked git push and git worktree add mid-flow (p6).
      HARNESS_PERMISSIONS,
      ...(usePath
        ? []
        : [
            `Note: ${
              onPath === undefined
                ? 'no otea is on your PATH'
                : `the otea on your PATH (${onPath.file}) is another install`
            }, so the entry below runs this one (${OTEA_MAIN}) by its absolute path.`,
          ]),
      ...mcpInstructionText(entry),
      ...(old
        ? [
            `${old} still has the otea entry an older otea connect wrote, which gives every session there one agent name: remove that entry and add the server as above.`,
          ]
        : []),
    ];
    return {
      data: { agentsMd, mcp, ...(name === undefined ? {} : { agent: name }) },
      text: text.join('\n'),
    };
  },
};

// `default` is no icon name, so it can stand for going back to the preset's icon.
const DEFAULT_ICON = 'default';

const collectionIconCommand: Command = {
  name: 'collection icon',
  summary: `Give a collection its own icon, or "${DEFAULT_ICON}" to go back to the icon it came with`,
  args: ['name', 'icon'],
  options: {},
  execute: ({ cwd, args: [name = '', icon = ''] }) => {
    const collection = withProject(cwd, (project) => {
      const changed = setCollectionIcon(project, name, icon === DEFAULT_ICON ? null : icon);
      return { ...changed, icon: collectionIcon(project, changed) };
    });
    const own = icon === DEFAULT_ICON ? ` (its preset's)` : '';
    return {
      data: collection,
      text: `Collection "${collection.name}" shows icon ${collection.icon ?? 'none'}${own}`,
    };
  },
};

// A value from a file (--field-file key=path, or key=- for stdin), as an editor or a shell leaves
// it: without a BOM (PowerShell 5's utf8) and without the line break that ends the file.
async function fieldFileValue(input: Input, path: string): Promise<string> {
  let text: string;
  if (path === '-') {
    text = await input.stdin();
  } else {
    const file = resolve(input.cwd, path);
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new OteaError('file_not_found', `No file at ${file}`);
    }
  }
  return text.replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
}

async function fieldsFrom(input: Input): Promise<FieldValues> {
  const { option, options } = input;
  const fields: FieldValues = {};
  const set = (key: string, value: string) => {
    if (key === 'title') throw new UsageError('Use --title for the title');
    if (key in fields) throw new UsageError(`Field "${key}" given twice`);
    fields[key] = value;
  };
  const description = option('description');
  if (description !== undefined) set('description', description);
  for (const pair of options('field')) set(...fieldPair(pair, FILE_HINT));
  for (const pair of options('field-file')) {
    const [key, path] = fieldPair(pair, '', 'field-file', '<file>');
    set(key, await fieldFileValue(input, path));
  }
  return fields;
}

// What a field's usage error adds where --field-file is taken.
const FILE_HINT =
  '; a long or multi-line value from a file: --field-file "<key>=<file>" (or <key>=- to read stdin)';

// key=value, or a usage error with an example, then `hint` (<key> in it named as the field given).
function fieldPair(pair: string, hint = '', option = 'field', value = '<value>'): [string, string] {
  const separator = pair.indexOf('=');
  if (separator < 1) {
    const key = pair || '<name>';
    const more = hint.replaceAll('<key>', key);
    throw new UsageError(
      `--${option} expects key=value, got "${pair}": such as --${option} "${key}=${value}"${more}`,
    );
  }
  return [pair.slice(0, separator), pair.slice(separator + 1)];
}

// Long values over the CLI: the MCP tools take them as they are, so they have no --field-file.
const FIELD_FILE = { multiple: true, placeholder: 'key=file' } as const;

// What create and update --help add on the fields they take.
const FIELD_DETAILS = [
  `--description fills the board's description field (Descripción on Errores), or else the first long text its form asks; a board with neither refuses it: give its fields by name with --field "<name>=<value>" (otea board <name> says what each takes).`,
  '--field-file "<name>=<file>" takes a long or multi-line value from a file, or from stdin with <name>=-.',
].join('\n');

const create: Command = {
  name: 'create',
  summary:
    'Create an item and say where it starts: on a board whose first step is skipped for an item that has everything it asks, at the next step; an item of a board that is always part of another needs --parent',
  details: FIELD_DETAILS,
  args: [],
  options: {
    collection: { required: true },
    type: { placeholder: 'type' },
    title: { required: true },
    description: {},
    field: { multiple: true, placeholder: 'key=value' },
    'field-file': FIELD_FILE,
    parent: { placeholder: 'id' },
    from: { placeholder: 'topic' },
    'from-message': {
      placeholder: 'id',
      about: "secretary: the person's message this item answers",
    },
    'from-bandeja': {
      placeholder: 'B-n',
      about:
        'refiner: the Bandeja entry you hold (B-3) this item refines; it is filed under the item',
    },
  },
  execute: async (input) => {
    const collection = input.required('collection');
    const type = input.option('type');
    const title = input.required('title');
    const parent = input.option('parent');
    const from = input.option('from');
    const fromMessage = input.option('from-message');
    const fromBandeja = input.option('from-bandeja');
    if (fromMessage !== undefined && fromBandeja !== undefined) {
      throw new UsageError(
        'An item comes from a message or a Bandeja note, not both: give --from-message or --from-bandeja',
      );
    }
    const fields = await fieldsFrom(input);
    const { actor, channel } = input;
    return withAgent(input, (project) => {
      // The topic the item comes from, checked before anything is made.
      const topic = from === undefined ? undefined : requireTopic(project, from);
      // The Bandeja entry too: held by this agent, checked before anything is made.
      const entry = fromBandeja === undefined ? undefined : bandejaIdOf(fromBandeja);
      if (entry !== undefined) requireBandejaHold(project, entry, actor.name);
      // The message too, and that this agent may link it: only the secretary does.
      const message = fromMessage === undefined ? undefined : messageIdOf(fromMessage);
      if (message !== undefined) requireLinkableMessage(project, actor.name, message);
      const item = createItem(project, {
        collection,
        ...(type === undefined ? {} : { type }),
        title,
        fields,
        ...(parent === undefined ? {} : { parent }),
        actor,
        channel,
        ...(input.unnamedTerminal ? { via: 'terminal' as const } : {}),
      });
      if (topic) linkTopic(project, { id: topic.id, item: item.id, via: 'from' });
      if (message !== undefined) linkMessageToItem(project, actor.name, message, item.id);
      // The entry is filed under the item it became: its wait ends.
      const filed =
        entry === undefined
          ? undefined
          : fileBandeja(project, { id: entry, agent: actor.name, item: item.id });
      // On a board: where it starts, and why when its first step was skipped or lacks something.
      const started = createdTextOf(project, item) ?? item.id;
      return {
        data: { ...itemData(project, item), ...(filed ? { bandeja: filed.ref } : {}) },
        text: filed ? `${started}\nFiled ${filed.ref} under ${item.id}.` : started,
      };
    });
  },
};

function listFilter({ option, options, flag, reader }: Input): ListItemsFilter {
  const filter: ListItemsFilter = {};
  const collection = option('collection');
  const state = option('state');
  const type = option('type');
  const turn = option('turn');
  const parent = option('parent');
  if (collection !== undefined) filter.collection = collection;
  if (parent !== undefined) filter.parent = parent;
  if (state !== undefined) filter.state = state;
  if (type !== undefined) filter.type = type;
  if (turn !== undefined) filter.turn = turn as Turn;
  if (flag('unclaimed')) filter.availableTo = reader.name;
  for (const [key, value] of options('field').map((pair) => fieldPair(pair))) {
    filter.fields ??= {};
    if (key in filter.fields) throw new UsageError(`Field "${key}" given twice`);
    filter.fields[key] = value;
  }
  return filter;
}

// What the person put on top first, then the order they fixed on the Matrix, as otea next takes
// them; then the other open items, and the closed ones last (P1-R3-11), each in creation order
// (the sort is stable).
function byPersonOrder<T extends { id: string; turn: string }>(
  items: readonly T[],
  order: ReadonlyMap<string, { pin?: number; rank?: number }>,
): T[] {
  const key = (item: T) => {
    const placed = order.get(item.id);
    return [
      Number(item.turn === 'none'),
      placed?.pin ?? Number.POSITIVE_INFINITY,
      placed?.rank ?? Number.POSITIVE_INFINITY,
    ];
  };
  return [...items].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    const at = ka.findIndex((value, index) => value !== kb[index]);
    return at < 0 ? 0 : (ka[at] ?? 0) < (kb[at] ?? 0) ? -1 : 1;
  });
}

const list: Command = {
  name: 'list',
  summary:
    'List items in creation order, with the order the person set beside those it places (on top 1, order 2: what they put on top and fixed on the Matrix, as otea next takes them), optionally filtered; --unclaimed hides items others hold, --parent keeps the children of an item, --field key=value (repeatable) keeps items whose field holds exactly that value; --state and --field take the board names (any case) or ids; --sort order puts what the person ordered first',
  args: [],
  options: {
    collection: {},
    type: {},
    state: {},
    turn: { choices: TURNS },
    parent: { placeholder: 'id' },
    field: { multiple: true, placeholder: 'key=value' },
    unclaimed: { flag: true },
    sort: { choices: ['created', 'order'] },
  },
  execute: (input) => {
    return withReader(input, (project) => {
      // A step and fields named as the board names them, or by id: each item on its own board.
      const filter = listFilter(input);
      const { state: _state, fields: _fields, ...stored } = filter;
      // The person's order beside each item it places, as otea next takes them.
      const order = priorityOf(project.db);
      const listed = listItems(project, stored).filter(readerFilter(project, filter));
      const items = input.option('sort') === 'order' ? byPersonOrder(listed, order) : listed;
      // Done with its branch not merged yet reads as the desk says it, never as merged (P6-R2-11).
      const boards = liveBoards(project);
      const shown = items.map((item) => {
        const named = readable(project, item);
        return rowFactsOf(project, item, boards).merge === 'waiting'
          ? { ...named, state: `${named.state}, not merged` }
          : named;
      });
      const boardOf = boardsOf(project);
      return {
        data: items.map((item) => {
          const placed = order.get(item.id);
          const data = itemData(project, item, boardOf);
          return placed && Object.keys(placed).length > 0 ? { ...data, priority: placed } : data;
        }),
        text: formatItems(shown, typesShown(project), order),
      };
    });
  },
};

// --brief on next and show leaves out the board's words and the step's "Before you hand it off":
// for the repeat read of an item the agent holds and already read in this session. Every reading
// is whole without it, as only the agent knows what it read (a new session, a compacted context, a
// step edited in Studio since).
const BRIEFING = { brief: { flag: true as const } };

const show: Command = {
  name: 'show',
  summary:
    'Show an item, what to do with it now, its fields, the moves available to the agent and its events timeline; --brief leaves out the board and step instructions: only to read again an item you hold and already read',
  args: ['id'],
  options: { ...BRIEFING },
  execute: (input) => {
    const [id = ''] = input.args;
    const { reader: actor, channel } = input;
    const performer = { actor, channel };
    return withReader(input, (project) => {
      const shown = showItem(project, id, performer);
      const brief = input.flag('brief');
      // Over MCP the fields come once, as one JSON object line the agent parses (not again under
      // Starts with); brief leaves Starts with out anywhere.
      const asJson = input.fieldsAsJson === true;
      const look: Look = {
        ...(brief ? { brief: true as const } : {}),
        ...(brief || asJson ? { startsAs: 'none' as const } : {}),
      };
      const gitHook = gitHookOf(project, shown);
      // Each event's profile is left to otea events: show stays within its token budget.
      const item = {
        ...shown,
        // Each file with a path an agent can open, under its own name (P5-R2-4).
        evidence: shown.evidence.map((entry) => {
          const path = evidenceReadPath(project.dataDir, entry);
          return path === undefined ? entry : { ...entry, path };
        }),
        events: shown.events.map(({ profile: _profile, ...event }) => event),
        hint: hintFor(project, shown, actor.name, look),
        ...(gitHook === undefined ? {} : { gitHook }),
      };
      const { layout } = typeOfItem(project, shown);
      const named = liveBoardOf(project, item.collection) !== undefined;
      // Evidence is grouped by the module id it went to: its part name would match no module.
      const text = formatItemWithEvents(
        { ...readable(project, item), evidence: item.evidence },
        layout,
        typesShown(project),
        named,
        asJson,
      );
      // The person's notes of this round, as data too: the text has them in its Next: block.
      const notes = roundNotesOf(project, item.id);
      const data = itemData(project, item);
      const stray = baseStray(project, input.cwd, shown);
      // Other open items that change the files this one does (src/app/overlap.ts).
      const sharing = overlapsOf(project, requireItem(project.db, shown.id));
      // A round that only merges main into the approved work (src/app/merge-only.ts).
      const mergeOnly = mergeOnlyOf(project, shown.id);
      // The turn of the conversation it came from (the secretary's requests).
      const fromMessages = turnsOfItem(project, shown.id);
      // The Bandeja entry it was refined from.
      const fromBandeja = bandejaOfItem(project, shown.id);
      const heads = [
        fromMessageLine(fromMessages),
        fromBandeja === undefined
          ? undefined
          : `Refined from the Bandeja, ${fromBandeja.ref}: "${fromBandeja.snippet}". Read the whole note with otea bandeja ${fromBandeja.ref}.`,
        mergedOutsideLine(project, input.cwd, shown),
        stray?.text,
        ...(mergeOnly ? [mergeOnlyText(shown.id, mergeOnly)] : []),
        ...sharing.map((overlap) => overlapText(shown.id, overlap)),
      ].filter((line): line is string => line !== undefined);
      const said =
        heads.length === 0
          ? text
          : `${heads.join('\n')}

${text}`;
      return {
        data: {
          ...data,
          ...(notes.length === 0 ? {} : { notes }),
          ...(fromMessages.length === 0 ? {} : { fromMessages }),
          ...(fromBandeja ? { fromBandeja } : {}),
          ...(stray ? { baseStray: stray } : {}),
          ...(sharing.length === 0 ? {} : { overlaps: sharing }),
          ...(mergeOnly ? { mergeOnly } : {}),
        },
        text: said,
      };
    });
  },
};

// otea board's index opens with Otea's agent guide, where AGENTS.md sends a CLI agent (and an MCP
// one whose client shows no instructions) to read it once; one board gives it no second time.
// --json keeps the data alone.
const withAgentGuide = (project: Project, text: string) =>
  `${agentGuideFor(topicsGuided(project))}\n\n${text}`;

const boardName = (record: BoardRecord) => (record.live ?? record.draft)?.definition.name ?? '';

const boardAdd: Command = {
  name: 'board add',
  summary: `For the person, with no agent name: make a board and publish it, from a template (${TEMPLATE_KEYS}) or blank, in ${LANGUAGE_RULE} or the one --lang gives, once, which is how to force one; --item names what each item is; a set such as ideas or repos makes all of its boards, the name and --item naming the first; --prefix chooses how its item ids start (2 to 6 letters or digits; one board only)`,
  details: TEMPLATE_LIST,
  args: ['name'],
  options: {
    template: { placeholder: 'key' },
    item: {},
    lang: { choices: LANGS },
    prefix: { placeholder: 'letters' },
  },
  execute: ({ cwd, args: [name = ''], option, agent }) => {
    // --lang (checked against LANGS as the option's choices); the project's language without it.
    const forced = option('lang') as Lang | undefined;
    // Publishing is the person's: an agent that names itself proposes the board instead.
    if (agent !== undefined) {
      throw new OteaError(
        'forbidden',
        `otea board add publishes a board as the person. An agent proposes one for the person to publish in Studio: otea board draft --new "${name.trim()}" --why "<what it is for>" --as ${agent}`,
      );
    }
    const template = option('template');
    const item = option('item');
    const prefix = option('prefix');
    if (template !== undefined && isSetKey(template)) {
      if (prefix !== undefined)
        throw new UsageError(
          `--prefix names the ids of one board, and ${template} makes several: add it without --prefix`,
        );
      const boards = withProject(cwd, (project) =>
        addBoardSet(project, {
          set: template,
          lang: forced ?? projectLanguage(project),
          by: { kind: 'human', name: 'human' },
          boards: [{ name, ...(item === undefined ? {} : { item }) }],
        }),
      );
      const names = boards.map(({ record }) => `"${boardName(record)}"`).join(', ');
      return { data: boards, text: `Published boards ${names} from template ${template}` };
    }
    const added = withProject(cwd, (project) =>
      addBoard(project, {
        name,
        lang: forced ?? projectLanguage(project),
        by: { kind: 'human', name: 'human' },
        ...(template === undefined ? {} : { template }),
        ...(item === undefined ? {} : { item }),
        ...(prefix === undefined ? {} : { prefix }),
      }),
    );
    const ids = added.record.collection
      ? withProject(
          cwd,
          (project) => getCollection(project.db, added.record.collection ?? '').prefix,
        )
      : '';
    const from = template === undefined ? 'blank' : `from template ${template}`;
    return {
      data: added,
      text: `Published board "${name.trim()}" v${added.version} ${from} (ids ${ids}-<n>)`,
    };
  },
};

// The board.json an agent hands in: the file it names, or, with --file -, what it pipes in, so it
// needs no file outside the project (P1-R3-10). `piped`: stdin, read before the command opens the
// project.
function draftFile(cwd: string, file: string, piped?: string): string {
  if (file === '-') {
    if (piped?.trim()) return piped;
    throw new OteaError(
      'missing_fields',
      'Nothing came on stdin: pipe the board JSON into otea board draft --file - (a here-document of your shell), give --file a path, or pass the JSON itself as --definition (over MCP, board_draft takes it as definition)',
    );
  }
  const path = resolve(cwd, file);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new OteaError('file_not_found', `No file at ${path}`);
  }
}

function handedInLines(id: string, submitted: Submitted): string[] {
  return [
    `Handed in the board draft on ${id} (evidence ${submitted.evidence.id}); it is in Studio now, for the person to try and publish.`,
    ...(submitted.notes.length === 0
      ? []
      : ["Read as today's board:", ...submitted.notes.map((n) => `  ${n}`)]),
    ...(submitted.problems.length === 0
      ? []
      : ['Still to fix, for it to be published:', ...submitted.problems.map((p) => `  ${p}`)]),
  ];
}

// The board's page in Studio, on the port otea serve runs on (or would).
function studioLink(project: Project, board: string): string {
  const page = projectPage(portToOpen(undefined), project.identity.id);
  return `${page}#/studio/board/${encodeURIComponent(board)}`;
}

// otea board draft --new: the agent the person asked for a board starts it; the person publishes.
// Where the board JSON an agent hands in comes from: --definition, the JSON itself (a client with
// no shell has no stdin to pipe it on, nor a file to write: P8-F2), else --file, a path or `-` for
// what is piped in. `piped` is read before the command opens the project.
async function draftSource(input: Input): Promise<{ file?: string; piped?: string }> {
  const definition = input.option('definition');
  if (definition !== undefined) {
    if (input.option('file') !== undefined) {
      throw new UsageError('Give --definition (the board JSON) or --file, not both');
    }
    return { file: '-', piped: definition };
  }
  const file = input.option('file');
  // A tool call has no stdin to read the board from: say where it goes, not a command to pipe
  // into, which an MCP agent cannot run.
  if (file === '-' && input.channel === 'mcp') {
    throw new UsageError(
      'file "-" reads the board JSON from stdin, which a tool call does not have: give the JSON as definition (an object or a string), or file as a path on this machine',
    );
  }
  return {
    ...(file === undefined ? {} : { file }),
    ...(file === '-' ? { piped: await input.stdin() } : {}),
  };
}

function proposeBoard(
  input: Input,
  name: string,
  { file, piped }: { file?: string; piped?: string },
): Output {
  const why = input.option('why')?.trim() ?? '';
  const template = input.option('template');
  return withAgent(input, (project) => {
    if (why === '')
      throw new OteaError('missing_fields', 'Say what the board is for: --why "<what it is for>"');
    const text = file === undefined ? undefined : draftFile(input.cwd, file, piped);
    const { actor, channel } = input;
    const made = proposeAgentDraft(project, {
      name,
      need: why,
      lang: projectLanguage(project),
      actor,
      channel,
      ...(text === undefined ? {} : { text }),
      ...(template === undefined ? {} : { template }),
    });
    const studio = studioLink(project, made.board.id);
    const lines = [
      ...(made.submitted ? handedInLines(made.item, made.submitted) : []),
      `The board "${name.trim()}" waits in Studio for the person to try and publish, on the Pedido ${made.item} you hold: ${studio}`,
      ...(made.others.length === 0
        ? []
        : [
            `Made with it, from the same template, as drafts the person publishes together with it: ${made.others.map((record) => `"${boardName(record)}"`).join(', ')}`,
          ]),
      ...(made.submitted ? [] : [handInText(made.item, actor.name)]),
    ];
    return { data: { ...made, studio }, text: lines.join('\n') };
  });
}

// otea board draft --change: the agent the person asked to change a published board opens the
// change on a Pedido it holds; the live board works on, and the person publishes it in Studio.
function proposeChange(
  input: Input,
  board: string,
  { file, piped }: { file?: string; piped?: string },
): Output {
  const why = input.option('why')?.trim() ?? '';
  return withAgent(input, (project) => {
    if (why === '')
      throw new OteaError('missing_fields', 'Say what to change: --why "<what to change>"');
    const text = file === undefined ? undefined : draftFile(input.cwd, file, piped);
    const { actor, channel } = input;
    const made = proposeBoardChange(project, {
      board,
      need: why,
      lang: projectLanguage(project),
      actor,
      channel,
      ...(text === undefined ? {} : { text }),
    });
    const name = made.board.draft?.definition.name ?? board;
    const studio = studioLink(project, made.board.id);
    const lines = [
      ...(made.submitted ? handedInLines(made.item, made.submitted) : []),
      `The change to the board "${name}" waits in Studio for the person to try and publish, on the Pedido ${made.item} you hold; the board works as it is until then: ${studio}`,
      ...(made.submitted ? [] : [handInText(made.item, actor.name)]),
    ];
    return { data: { ...made, studio }, text: lines.join('\n') };
  });
}

const boardDraft: Command = {
  name: 'board draft',
  summary:
    'Draft the board a Pedido asks for: without --file, print the draft to start from (JSON); with --file, check it as a board and hand it in on the Pedido as board.json, saying what is still wrong (the board keeps the name it was asked for; the name in the file is not used). To propose a new board the person asked you for, --new <name> --why "<what it is for>" (--template <key> to start from a catalogue board or a set such as ideas or repos, which makes its other boards with it; --file to hand it in at once) makes it and its Pedido, which you hold; --change <board> does the same for a change to a published board (a field, a step); the person publishes it in Studio',
  details: TEMPLATE_LIST,
  args: ['id?'],
  options: {
    file: { placeholder: 'board.json' },
    definition: {
      placeholder: 'board JSON',
      about: 'the board JSON itself, in place of --file (a client with no shell has no stdin)',
    },
    new: { placeholder: 'name' },
    why: { placeholder: 'what it is for' },
    template: { placeholder: 'key' },
    change: { placeholder: 'board' },
  },
  execute: async (input) => {
    const [id] = input.args;
    const name = input.option('new');
    const change = input.option('change');
    if ([id, name, change].filter((given) => given !== undefined).length > 1)
      throw new UsageError('Give the Pedido, --new <name> or --change <board>, only one');
    // --file - takes the board JSON from stdin (P1-R3-10); --definition is the JSON itself.
    const source = await draftSource(input);
    if (name !== undefined) return proposeBoard(input, name, source);
    if (change !== undefined) {
      if (input.option('template') !== undefined)
        throw new UsageError('--template goes with --new <name>');
      return proposeChange(input, change, source);
    }
    if (id === undefined) throw new UsageError('Give the Pedido, or --new <name> for a new board');
    if (input.option('why') !== undefined)
      throw new UsageError('--why goes with --new <name> or --change <board>');
    if (input.option('template') !== undefined)
      throw new UsageError('--template goes with --new <name>');
    const { file, piped } = source;
    return withAgent(input, (project) => {
      if (file === undefined) {
        const definition = draftToStartFrom(project, id);
        return { data: definition, text: JSON.stringify(definition, null, 2) };
      }
      const text = draftFile(input.cwd, file, piped);
      const { actor, channel } = input;
      const submitted = submitAgentDraft(project, { id, text, actor, channel });
      return { data: submitted, text: handedInLines(id, submitted).join('\n') };
    });
  },
};

// otea prompt: what the person pastes into an agent's chat, as the UI copies it. With no moment it
// picks the project's: the first contact where there is no project or no board of its own, the
// join prompt (written from the project as it is now) once there are boards.
function projectPrompt(cwd: string, kind: PromptKind | undefined, asked: Lang | undefined): string {
  const empty = { boards: [], working: [] };
  let project: Project;
  try {
    project = openProject(cwd);
  } catch (error) {
    if (error instanceof OteaError && error.code === 'not_found' && kind !== 'join')
      return agentPrompt(kind ?? 'start', asked ?? defaultLang(), empty);
    throw error;
  }
  try {
    const moment = kind ?? promptKindOf(project);
    return agentPrompt(moment, asked ?? projectLanguage(project), promptFacts(project, moment));
  } finally {
    project.db.close();
  }
}

// The language a role's text is written in: the one asked, else the project's, else the one the
// person uses where there is no project yet.
// A worker's board must exist in the project (and is named as the project names it).
function projectRolePrompt(
  cwd: string,
  role: Role,
  asked: Lang | undefined,
  facts: RoleFacts,
): string {
  let project: Project;
  try {
    project = openProject(cwd);
  } catch (error) {
    // No project: a secretary's or a refiner's text needs none, a worker's board cannot exist.
    if (error instanceof OteaError && error.code === 'not_found' && !roleTakesBoard(role))
      return rolePrompt(role, asked ?? defaultLang(), facts);
    throw error;
  }
  try {
    const board = facts.board === undefined ? {} : { board: roleBoard(project, facts.board) };
    return rolePrompt(role, asked ?? projectLanguage(project), { ...facts, ...board });
  } finally {
    project.db.close();
  }
}

const promptCommand: Command = {
  name: 'prompt',
  summary:
    "Print what to paste into an agent's chat: start (a new project: set up, connect, read the project, interview you to understand what you need, one question at a time, tell you plainly whether a template fits, fits with changes, needs a board of its own or Otea is not a good fit, and draft its boards), join (one more agent working the boards there are, named from the project now) or design (one more board); without one, start until the project has boards of its own, then join. Or --role secretary (the chat you talk to: it answers you shortly, turns requests into items on boards, keeps workers and a refiner running, never doing an item itself), --role worker --board <name> [--as <name>] (what the secretary gives each worker, or you paste into a new chat; without --as it tells the worker to pick a name with otea whoami) or --role refiner [--as <name>] (turns the Bandeja's rough notes into items). --lang en|es (default: the project's language, set when it was made; with no project yet, the one you use: the desk's, else this computer's, else English)",
  args: ['moment?'],
  options: {
    lang: { placeholder: 'en|es' },
    role: { placeholder: ROLES.join('|') },
    board: { placeholder: 'name' },
  },
  execute: (input) => {
    const [moment] = input.args;
    if (moment !== undefined && !isPromptKind(moment))
      throw new UsageError(`The moment is one of ${PROMPT_KINDS.join(', ')}`);
    const lang = input.option('lang');
    if (lang !== undefined && lang !== 'en' && lang !== 'es')
      throw new UsageError('--lang is en or es');
    const role = input.option('role');
    const board = input.option('board');
    const name = input.option('as');
    if (role === undefined) {
      if (board !== undefined || name !== undefined)
        throw new UsageError(`--board and --as go with --role ${ROLES.join('|')}`);
      const text = projectPrompt(input.cwd, moment as PromptKind | undefined, lang);
      return { data: { prompt: text }, text };
    }
    if (!isRole(role)) throw new UsageError(`--role is one of ${ROLES.join(', ')}`);
    if (moment !== undefined) throw new UsageError('Give a moment or a --role, not both');
    if (role === 'worker' && board === undefined)
      throw new UsageError('--role worker needs --board <name>: the board it works');
    if (!roleTakesBoard(role) && board !== undefined)
      throw new UsageError(
        `--role ${role} takes no --board: only a worker works one board (the secretary gives each its own)`,
      );
    // Only a name given with --as fills the text: the session's own (OTEA_AGENT) is the printer's,
    // never the worker's.
    if (name !== undefined) assertAgentName(name);
    const text = projectRolePrompt(input.cwd, role, lang, {
      ...(board === undefined ? {} : { board }),
      ...(name === undefined ? {} : { name }),
    });
    return { data: { prompt: text }, text };
  },
};

const board: Command = {
  name: 'board',
  summary:
    'Print what agents read about a board before acting: its own words for them and each step\'s instructions; without a name, the project\'s boards and how to read each. To propose a new board, otea board draft --new "<name>" --why "<what it is for>"; the person publishes it in Studio',
  args: ['name?'],
  options: {},
  execute: (input) => {
    const [name = ''] = input.args;
    return withReader(input, (project) => {
      if (name !== '') {
        const guide = boardGuide(project, name);
        return { data: guide, text: guide.text };
      }
      const boards = guideIndex(project);
      const index =
        boards.length === 0
          ? 'No boards yet; a human makes one in Studio or with "otea board add <name>".'
          : [
              'Read the board you work in before acting:',
              indent(
                columns(
                  boards.map(({ name: each, board: id, command }) => [
                    each,
                    id === null ? 'draft' : 'board',
                    command,
                  ]),
                ),
              ),
            ].join('\n');
      return { data: { boards }, text: withAgentGuide(project, index) };
    });
  },
};

const move: Command = {
  name: 'move',
  summary: 'Move an item to another state its workflow allows the agent to reach',
  args: ['id', 'state'],
  options: { reason: {} },
  execute: (input) => {
    const [id = '', to = ''] = input.args;
    const { actor, channel, option } = input;
    const reason = option('reason');
    const moving = { id, to, actor, channel, ...(reason ? { reason } : {}) };
    return withAgent(input, (project) => itemResult(project, moveItem(project, moving)));
  },
};

// The guide's topics rule without its number, nor its opening (next and wait say it their way).
const TOPICS_TEXT = TOPICS_RULE.replace(/^\d+\. Topics are on\. /, '');

// What otea wait woke an agent for, with the topics reminder while topics are on: an agent in a
// chat reads it between the person's messages, where side questions come.
function withTopicsReminder(project: Project, actor: Actor, output: Output): Output {
  if (actor.kind !== 'agent' || !topicsGuided(project)) return output;
  const data =
    output.data !== null && typeof output.data === 'object'
      ? { ...(output.data as object), reminder: TOPICS_REMINDER }
      : output.data;
  return { ...output, data, text: `${output.text}\n\n${TOPICS_REMINDER}` };
}

// While topics are on, next names the topics waiting for the agent's answer (a note otea wait woke
// it for is still there once it runs next) and the topics rule, which an agent whose session began
// before the person turned topics on never read in its guide. Brief: the topics waiting only; the
// rule is in the guide, and in the whole next.
function topicLines(project: Project, agent: string, brief = false): string[] {
  if (!topicsOn(project)) return [];
  // With a secretary, no agent is told to record topics; a person's note on a topic still waits.
  const guided = topicsGuided(project);
  const awaiting = topicsAwaitingText(topicsAwaiting(project, agent));
  if (brief || !guided) return awaiting === undefined ? [] : [awaiting];
  const rule = `Topics are on. ${TOPICS_TEXT}`;
  return awaiting === undefined ? [rule] : [awaiting, rule];
}

const next: Command = {
  name: 'next',
  summary:
    'Say which item to take now on the published boards (or in --collection), sent-back ones first, then approved work, then new, each in the Matrix order, and what its step asks: what it starts with, the instructions, the handoff and where it goes next; when there is none, what to do meanwhile. Never offers an item another agent holds or was just offered; --claim also claims it in the same call. --brief leaves out the board and step instructions: only to read again an item you hold and already read',
  args: [],
  options: {
    collection: {},
    claim: { flag: true },
    // A subagent has a profile of its own to declare before its first next: given here, one call
    // does both (P1-F6).
    model: { placeholder: 'id', about: 'declares your profile first, as profile does' },
    effort: { placeholder: 'level' },
    harness: { placeholder: 'name' },
    ...BRIEFING,
  },
  execute: (input) => {
    const collection = input.option('collection');
    const claim = input.flag('claim');
    const { actor, channel } = input;
    const brief = input.flag('brief');
    const model = input.option('model');
    const effort = input.option('effort');
    const given = input.option('harness');
    return withAgent(input, (project) => {
      if (model !== undefined || effort !== undefined) {
        declareFromOptions(input, project, {
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { effort }),
          ...(given === undefined ? {} : { given }),
        });
      }
      const profile = requireProfile(project.db, actor.name, { channel, confirmed: true });
      const answer = nextFor(project, actor.name, {
        ...(collection === undefined ? {} : { collection }),
        ...(claim ? { claim, baseTipsOf: claimedBaseTips(project, input.cwd) } : {}),
        ...(brief ? { brief: true } : {}),
        // Over MCP the item's fields come as one JSON object line, which a model parses.
        ...(input.fieldsAsJson ? { startsAs: 'json' as const } : {}),
      });
      const offered = answer.item === null ? undefined : getItem(project, answer.item);
      const outside = offered && mergedOutsideLine(project, input.cwd, offered);
      // Offered work in the shared main checkout says so before the agent starts (P6-R2-3).
      const shared = offered && sharedCheckoutLine(project, input, offered.id);
      const remote = remoteAddedNotice(project, input.cwd);
      // The turn of the conversation the item came from, when it came from one.
      const fromMessages = answer.item === null ? [] : turnsOfItem(project, answer.item);
      const fromLine = fromMessageLine(fromMessages);
      // It always ends with the exact command to keep waiting: told only to wait, agents ended
      // their turn, and the person's answer on the desk went unheard.
      const text = [
        ...(outside ? [outside] : []),
        // Looking is not free: no other agent is offered it meanwhile (P1-F4), so it is said.
        answer.item !== null && answer.offered
          ? `${answer.text}\n${offeredLine(answer.item)}`
          : answer.text,
        ...(fromLine ? [fromLine] : []),
        ...(shared ? [shared] : []),
        ...(remote ? [remote] : []),
        ...topicLines(project, actor.name, answer.brief === true),
        // A brief next leaves out what the agent already read, the profile line too.
        ...(answer.brief ? [] : [profileReminder(profile, actor.name, channel)]),
        keepWaitingLine(actor.name, channel, { idle: answer.idle === true, collection }),
      ].join('\n\n');
      return {
        data: {
          ...answer,
          text,
          profile: profileView(profile),
          ...(fromMessages.length === 0 ? {} : { fromMessages }),
        },
        text,
      };
    });
  },
};

// A move on a board: the engine checks it, the item lands where it says, and the agent reads where
// it stands now.
function boardMove(
  input: Input,
  run: (project: Project, move: BoardMoveInput) => BoardMoveResult,
): Output {
  const [id = ''] = input.args;
  const { actor, channel, option } = input;
  const way = option('way');
  const reason = option('reason');
  const note = option('note');
  const move = {
    id,
    actor,
    channel,
    ...(way === undefined ? {} : { way }),
    ...(reason ? { reason } : {}),
    ...(note ? { note } : {}),
  };
  return withAgent(input, (project) => {
    const { item, text } = run(project, move);
    return { data: { item: itemData(project, item), text }, text };
  });
}

// What a claim records of the checkout it is made in (P1-F3): where the base its item's board
// protects stands, so the commit an item later says it landed is told from what was already there.
// Nothing ([]) for an item whose board protects no base. Only the item's FIRST claim counts later,
// not each step's: an item sent back for another round keeps the commits it made in the first.
// Git is asked here, for every board's base, before the claim's transaction opens: the lookup it
// returns reads a map.
function claimedBaseTips(project: Project, cwd: string): BaseTips {
  const byCollection = new Map<string, string[]>();
  for (const board of liveBoards(project)) {
    const base = guardedBranch(board.def)?.guard.base;
    if (base !== undefined) byCollection.set(board.collection, baseTipsOf(cwd, base));
  }
  return (item) => byCollection.get(item.collection) ?? [];
}

// A board that says a commit landed on its base (Commit pushed, Commit en main: the guard's
// `commit` field) is told the truth: the hash an agent hands off must exist, be in the base, and,
// where the repo has a remote, be on the remote's branch of it after a fetch (P8-F1, P9-F5). The
// field took «banana», and the hash of a push the hook had refused, and the item went Done.
function refuseUnlandedCommit(project: Project, cwd: string, move: BoardMoveInput): void {
  if (move.actor.kind !== 'agent') return;
  const item = getItem(project, move.id);
  const board = liveBoardOf(project, item.collection);
  const position = positionOf(item.state);
  if (!board || isClosed(position) || position.phase !== 'doing') return;
  if (!movesOn(board.def, position.step, move.way)) return;
  const guard = guardedBranch(board.def);
  const ref = guard?.guard.commit;
  const base = guard?.guard.base;
  const part = ref === undefined ? undefined : board.def.parts[ref];
  if (!guard || !part || base === undefined) return;
  const hand = stepById(board.def, position.step)?.hand.find((each) => each.ref === part.id);
  const value = item.fields[part.id];
  // A value still missing is the engine's refusal, in its words.
  if (!hand || hand.req === 'no' || typeof value !== 'string' || value.trim() === '') return;
  const branch = String(item.fields[guard.id] ?? '').trim();
  const tip = branch === '' ? undefined : approvedTipOf(project, item.id, branch);
  // A tip recorded as unchanged (main held nothing the remote lacked at the handoff) is checked
  // too: an agent that pushed before handing off got it that way, and wrote an older hash.
  const approved = tip && { commit: tip.commit };
  // The commit must be this item's own (P1-F3): not one an item of the board that landed (is Done)
  // wrote, a draft holding a hash proves nothing, and not one the base held when this item was
  // first claimed (an older item has no such tips, and only the first rule applies).
  const landed = listItems(project, { collection: item.collection }).flatMap((other) => {
    const written = other.id === item.id ? undefined : other.fields[part.id];
    const done = positionOf(other.state);
    return typeof written === 'string' && isClosed(done) && done.closed === DONE
      ? [{ id: other.id, value: written }]
      : [];
  });
  // Only the item's first claim: a later one (the landing step's, after its own commit) holds the
  // item's own work. Without tips on it (an older item, or a claim made with no checkout) the rule
  // is skipped.
  const firstTips = item.events.find(({ type }) => type === 'claimed')?.data.baseTips;
  const claimTips = Array.isArray(firstTips) ? (firstTips as string[]) : undefined;
  const own = { landed, ...(claimTips ? { claimTips } : {}) };
  const refused = landedCommitRefusal(cwd, part.name, value, base, approved, own);
  if (refused) throw new OteaError('missing_fields', `${item.id} not handed off: ${refused}`);
}

// Whether a handoff of the step along `way` (none: the default one) takes the item on, to a later
// step or to Done, not back to an earlier one for another round. What the handoff of a branch
// checks (the branch has commits, the commit that landed is real) is checked for the forward moves,
// `--way Done` among them, and left alone for a way back (a rebase that conflicts goes back to
// Hacerlo with its work as it is). A way the step does not have is the engine's refusal.
function movesOn(def: BoardDefinition, stepId: string, way: string | undefined): boolean {
  if (way === undefined) return true;
  const target = wayByName(def, stepId, way);
  return target === undefined || target === DONE || stepIndex(def, target) > stepIndex(def, stepId);
}

// A step that hands a branch hands the work on it: an agent's handoff of one with no commits over
// its base (the board's protected base, else origin's default branch, main or master) leaves the
// review nothing to see. Only a branch this checkout has, here or on origin, is checked. The base
// itself, on a board that works straight on it, is handed off with no commit as no code change
// (P2S-R3-3, handedBranch).
function refuseEmptyBranch(project: Project, cwd: string, move: BoardMoveInput): void {
  if (move.actor.kind !== 'agent') return;
  const item = getItem(project, move.id);
  const board = liveBoardOf(project, item.collection);
  const position = positionOf(item.state);
  if (!board || isClosed(position) || position.phase !== 'doing') return;
  if (!movesOn(board.def, position.step, move.way)) return;
  const step = stepById(board.def, position.step);
  for (const hand of step?.hand ?? []) {
    const part = board.def.parts[hand.ref];
    const branch = part?.kind === 'branch' ? item.fields[part.id] : undefined;
    if (!part || hand.req === 'no' || typeof branch !== 'string' || branch.trim() === '') continue;
    const base = part.guard?.base;
    if (branch.trim() === base) continue;
    const bases = [...(base ? [base, `origin/${base}`] : []), 'origin/HEAD', 'main', 'master'];
    const over = commitsOver(cwd, branch.trim(), bases);
    if (over?.count !== 0) continue;
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${part.name} ${branch.trim()} has no commits over ${over.base}, so the review would find nothing in it. Commit your work on ${branch.trim()}, then hand it off again.`,
    );
  }
}

// The protected branch as git has it here when a step that pushes or hands it is handed off: kept
// with a handoff into a review, it is what the person approves, and all the push gate lets land
// once it is approved (P3C-R2-1). Before the branch freezes in review, an agent's handoff is
// refused when the branch it names is not here at all (P1-R2-2), or when it holds commits the
// remote branch of its name never got, on a step that pushes it (P3C-R2-2), or when it is not the
// work handed off: another open item's branch, or not the one checked out (P1-R3-1,
// refuseOthersBranch). One never pushed though the repo has a remote is refused into a review, where
// it would freeze (P6-R3-3); on a step nobody reviews it goes with a warning (P7-8). The base itself, on a board that works straight on it, is never pushed before
// the approval; when it holds nothing the remote lacks, the item made no code change (a setting, a
// question): it goes to review as such, said, and the push gate never waits on it (P2S-R3-3).
function handedBranch(
  project: Project,
  cwd: string,
  move: BoardMoveInput,
): {
  tip?: NonNullable<BoardMoveInput['tip']>;
  warning?: string;
  said?: string;
  overlaps?: NonNullable<BoardMoveInput['overlaps']>;
} {
  const item = getItem(project, move.id);
  const board = liveBoardOf(project, item.collection);
  const position = positionOf(item.state);
  const guard = board && guardedBranch(board.def);
  if (!guard || isClosed(position) || position.phase !== 'doing') return {};
  // A step that pushes the branch, or that hands it in (on main, the work is committed, not pushed,
  // before the approval).
  const pushes = guard.guard.push.includes(position.step);
  const hands = stepById(board.def, position.step)?.hand.some(({ ref }) => ref === guard.id);
  if (!pushes && !hands) return {};
  const branch = String(item.fields[guard.id] ?? '').trim();
  if (branch === '') return {};
  const base = branch === guard.guard.base;
  const forward = movesOn(board.def, position.step, move.way);
  const checked = move.actor.kind === 'agent' && forward && !base;
  const state = checked ? pushState(cwd, branch) : undefined;
  const frozen = `once handed off, ${guard.name} is frozen while it is reviewed`;
  if (state?.kind === 'missing') {
    const on = state.on && state.on !== guard.guard.base ? state.on : '<branch>';
    const where = state.on ? ` (you are on ${state.on})` : '';
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${guard.name} names ${branch}, a branch this checkout has neither here nor on the remote${where}. Set ${guard.name} to the branch that holds the work, otea update ${item.id} --field "${guard.name}=${on}", then hand it off again: ${frozen}.`,
    );
  }
  // On the land step, a branch only the local base holds is not landed yet: the handoff that closes
  // the item waits for the push of the base (P6-R3-2).
  const local =
    checked && isLandStep(board.def, position.step)
      ? mergedOutside(project, cwd, item)?.local
      : undefined;
  if (local) {
    const into = guard.guard.base ?? '';
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${branch} is in your local ${into}, not yet in ${local.remote}, so closing it would leave it Done with ${into} unpushed. Push it first (git push ${local.push} ${into}), then hand it off again.`,
    );
  }
  if (checked && hands && !isLandStep(board.def, position.step))
    refuseOthersBranch(project, cwd, move, item, guard.name, branch, guard.guard.base, frozen);
  // On the land step, once what the person approved is in the base as the remote has it (a forge
  // squash-merged the branch as it was pushed), commits here the remote never got (a rebase made
  // before the merge) need no push (P3C-R3-10).
  const landed =
    state?.kind === 'ahead' && isLandStep(board.def, position.step) && guard.guard.base
      ? landedBase(project, cwd, item.id, branch, guard.guard.base)
      : undefined;
  if (state?.kind === 'ahead' && pushes && landed === undefined) {
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${branch} holds commits ${state.remote} never got. Push it first (git push ${state.push} ${branch}), then hand it off again: ${frozen}, so the review would never see them.`,
    );
  }
  if (state?.kind === 'ahead' && landed !== undefined)
    return {
      said: `${branch} holds commits ${state.remote} never got, but what the person approved is in ${landed} already, so they need no push: never push a merged branch to pass a check.`,
    };
  const tip = tipOf(cwd, branch, base);
  const unpushed = state?.kind === 'unpushed' && pushes;
  // No board lets an approval close an item whose code lives only on a branch never pushed (P7-8):
  // where its Rama is meant for a base and the review's approval closes the item (no land step
  // after it), the push comes first. With a land step, the approval leads there instead.
  const step = stepById(board.def, position.step);
  const closes = step?.reviewer !== 'none' && waysOf(board.def, position.step, item)[0] === DONE;
  if (state?.kind === 'unpushed' && pushes && guard.guard.base && closes) {
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${branch} was never pushed to ${state.push}, and the approval of ${step?.name ?? position.step} closes ${item.id}, so it would be Done with its code only on this machine. Push it first (git push -u ${state.push} ${branch}), then hand it off again: ${frozen}.`,
    );
  }
  // Into a review the branch freezes, so a push after the handoff is refused (P6-R3-3): the push
  // comes first. A step nobody reviews (a land step) keeps the note.
  if (state?.kind === 'unpushed' && pushes && step?.reviewer !== 'none') {
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${branch} was never pushed to ${state.push}. Push it first (git push -u ${state.push} ${branch}), then hand it off again: ${frozen}, so no push of it gets through until the review ends.`,
    );
  }
  const unchanged =
    base &&
    hands &&
    move.actor.kind === 'agent' &&
    forward &&
    pushState(cwd, branch)?.kind === 'pushed';
  // A round that holds the same files as the one it answers (an empty commit, the old diff) is said
  // here and in the review; it is not refused, since an answer to a question changes no file
  // (P5-F2).
  const again =
    tip && hands && forward && step?.reviewer !== 'none' && !unchanged
      ? repeatsLastRound(project, item.id, item.state, tip)
      : undefined;
  // The files this branch shares with other open items' pushed branches: whichever lands second
  // merges main with the other's change in it, and a conflict there is another review round, so the
  // agent hears it now and the person in the review (src/app/overlap.ts).
  const recorded =
    tip && hands && forward && step?.reviewer !== 'none' && !unchanged && !unpushed
      ? overlapsRecord(project, requireItem(project.db, item.id))
      : undefined;
  const sharing = recorded?.list ?? [];
  const notes = [
    ...sharing.map((overlap) => `Note: ${overlapText(item.id, overlap)}`),
    ...(unpushed
      ? [
          `Note: ${branch} was never pushed to ${state.push}. If the person reviews it on the forge (a pull request), they cannot see it there: ${frozen}.`,
        ]
      : []),
    ...(again
      ? [
          `Note: ${branch} holds the same files as round ${again.round} (${again.commit.slice(0, 7)}): nothing changed since that round, and the review says so. If the person asked for a change, make it and hand off again.`,
        ]
      : []),
  ];
  const warning = notes.length === 0 ? undefined : notes.join('\n');
  const said = unchanged
    ? `${item.id} goes to review with no commit: ${branch} holds nothing the remote lacks, so the person reviews no code change and the push gate does not wait on it.`
    : undefined;
  const kept = tip && unpushed ? { ...tip, pushed: false as const } : tip;
  return {
    ...(kept ? { tip: unchanged ? { ...kept, unchanged: true as const } : kept } : {}),
    ...(warning ? { warning } : {}),
    ...(said ? { said } : {}),
    ...(recorded ? { overlaps: recorded } : {}),
  };
}

// A handoff into review hands the work on the branch Rama names, and its approval keeps that
// branch's tip (P1-R3-1): an agent's handoff is refused when another open item named that branch
// first, and, at the CLI, when the checkout it runs in is on another branch. Over MCP the server
// runs in the checkout its session started in, which a subagent in a worktree of its own shares,
// so the branch checked out there tells nothing: it is refused only when no checkout of the
// repository (a worktree too) has the branch. A detached HEAD (a rebase under way) tells nothing
// either way.
function refuseOthersBranch(
  project: Project,
  cwd: string,
  move: BoardMoveInput,
  item: Item,
  name: string,
  branch: string,
  base: string | undefined,
  frozen: string,
): void {
  const first = branchNamedFirst(project, item, branch);
  if (first)
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${name} names ${branch}, the branch ${first.id} (${first.title}, open) named first, so the review would read ${first.id}'s work and an approval would keep its tip. Each item works on its own branch: set ${name} to the branch that holds ${item.id}'s work, otea update ${item.id} --field "${name}=<branch>", then hand it off again: ${frozen}.`,
    );
  const on = checkedOutBranch(cwd);
  if (on === undefined || on === branch) return;
  if (move.channel === 'mcp') {
    // The server knows only the directory its session started in, which a subagent in a worktree
    // of its own shares: the branch checked out there tells nothing. Any checkout of the
    // repository that holds the Rama's branch does (P8-F1).
    if (branchCheckedOutAnywhere(cwd, branch) !== false) return;
    throw new OteaError(
      'missing_fields',
      `${item.id} not handed off: ${name} names ${branch}, but no checkout of this repository is on it (this one is on ${on}), so the review would read a branch other than the one you worked on. Check ${branch} out in the checkout you work in (git switch ${branch}, or git worktree add <dir> ${branch}), then hand it off again: ${frozen}.`,
    );
  }
  const set =
    on === base
      ? ''
      : `, or set ${name} to the branch that holds the work, otea update ${item.id} --field "${name}=${on}"`;
  throw new OteaError(
    'missing_fields',
    `${item.id} not handed off: ${name} names ${branch}, but this checkout is on ${on}, so the review would read a branch other than the one you worked on. Hand off from the checkout of ${branch} (git switch ${branch})${set}, then hand it off again: ${frozen}.`,
  );
}

// The base as the remote has it (origin/main), when what the person approved of the item's branch
// is in it already; undefined otherwise, or with no approved tip to tell.
function landedBase(
  project: Project,
  cwd: string,
  id: string,
  branch: string,
  base: string,
): string | undefined {
  const approved = approvedTipOf(project, id, branch);
  const onto = remoteOf(cwd, base);
  return approved && landedIn(cwd, approved.commit, onto) ? onto : undefined;
}

// Whether the item just handed off landed on the remote's base while the person's main checkout
// stayed behind. A notice never fails a handoff: where git cannot tell, it says nothing.
function localBehindAfter(cwd: string, id: string): LocalBehind | undefined {
  try {
    return withProject(cwd, (project) => localBehindOf(project, id));
  } catch {
    return undefined;
  }
}

const handoffCommand: Command = {
  name: 'handoff',
  summary:
    'Hand off the step you did on an item: refused, saying what is missing, until its handoff is complete; then to its review, or along --way (a step name or Done) with --reason when the step has several. --note is the note of the handoff, kept with the round (required where the step asks for one, and after a send-back); --way an earlier step, with --reason, takes the item back to it for its next round; again in review, --note amends it',
  args: ['id'],
  options: { way: { placeholder: 'step' }, reason: {}, note: {} },
  execute: (input) => {
    let warning: string | undefined;
    let said: string | undefined;
    const moved = boardMove(input, (project, move) => {
      refuseEmptyBranch(project, input.cwd, move);
      const handed = handedBranch(project, input.cwd, move);
      // After the branch's own checks, which say first that it was never pushed.
      refuseUnlandedCommit(project, input.cwd, move);
      warning = handed.warning;
      said = handed.said;
      // A round that only merges main into the approved work: asked of the remote once, here.
      const merge = handed.tip ? mergeRoundOf(project, move.id, handed.tip) : undefined;
      const done = handoffItem(project, {
        ...move,
        ...(handed.tip ? { tip: handed.tip } : {}),
        ...(merge ? { merge } : {}),
        ...(handed.overlaps ? { overlaps: handed.overlaps } : {}),
      });
      // A round that only merges main into the approved work is reviewed as that merge alone.
      const only = mergeOnlyOf(project, move.id);
      if (only)
        warning = [warning, `Note: ${mergeOnlyText(move.id, only)}`].filter(Boolean).join('\n');
      return done;
    });
    // An agent goes on to the next item, and waits when there is none: the reply ends with the
    // exact commands, so it neither stops after one nor says it waits with no wait running
    // (P3C-R3-9).
    const next = waitAgainLine(input.actor.name, input.channel);
    // Landed on the remote while the person's local base stayed behind: said plainly, to hand on.
    const behind = localBehindAfter(input.cwd, input.args[0] ?? '');
    const landedLine = behind ? localBehindText(input.args[0] ?? '', behind) : undefined;
    return {
      data: {
        ...(moved.data as object),
        next,
        ...(warning ? { warning } : {}),
        ...(said ? { unchanged: said } : {}),
        ...(behind ? { localBehind: behind } : {}),
      },
      text: [
        moved.text,
        ...(said ? [said] : []),
        ...(warning ? [warning] : []),
        ...(landedLine ? [landedLine] : []),
        next,
      ].join('\n'),
    };
  },
};

const dropCommand: Command = {
  name: 'drop',
  summary:
    'Drop an item that is not worth doing, saying why with --reason, and, on a board with motives, which one with --motive (its name); an agent drops only while doing a step that lets it',
  args: ['id'],
  options: { reason: {}, motive: {} },
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor, channel, option } = input;
    const reason = option('reason');
    const motive = option('motive');
    const dropping = {
      id,
      actor,
      channel,
      ...(reason ? { reason } : {}),
      ...(motive ? { motive } : {}),
    };
    return withAgent(input, (project) => {
      const { item, text } = dropItem(project, dropping);
      return { data: { item: itemData(project, item), text }, text };
    });
  },
};

// Approving and sending back a step the person reviews is theirs, in the desk; the person who runs
// approve at a terminal, told to by an agent, gets «Name yourself first» otherwise (P2S-R3-7).
function personReviews(input: Input, what: 'approve' | 'send-back'): void {
  if (input.agent !== undefined || input.channel === 'mcp') return;
  const [id = '<id>'] = input.args;
  const doing = what === 'approve' ? `Approving ${id} is` : `Sending ${id} back is`;
  throw new OteaError(
    'unnamed_agent',
    `${doing} the person's, in the desk: open ${id} there (otea serve gives its address) and approve it or send it back. An agent never approves a step the person reviews. An agent reviewing a step agents review names itself: otea ${what} ${id} --as <name>.`,
  );
}

const approveCommand: Command = {
  name: 'approve',
  summary: 'Approve the step you review, along --way when it has several; --note for the next step',
  args: ['id'],
  options: { way: { placeholder: 'step' }, note: {} },
  execute: (input) => {
    personReviews(input, 'approve');
    return boardMove(input, approveItem);
  },
};

const sendBack: Command = {
  name: 'send-back',
  summary:
    'Send the step you review on an item back for another round, saying what to change with --reason',
  args: ['id'],
  options: { reason: { required: true } },
  execute: (input) => {
    personReviews(input, 'send-back');
    input.required('reason');
    return boardMove(input, sendBackItem);
  },
};

const KINDS = RELATION_KINDS.join(', ');

const link: Command = {
  name: 'link',
  summary: `Link an item to another, in this project, with a typed relation (${KINDS}): "<id> blocks <other>" reads as it says, "<id> parent <other>" makes <other> the parent of <id>`,
  args: ['id', 'kind', 'other'],
  options: {},
  execute: (input) => {
    const [id = '', kind = '', other = ''] = input.args;
    const { actor, channel } = input;
    const relation = withAgent(input, (project) =>
      linkItems(project, { id, kind, other, actor, channel }),
    );
    return { data: relation, text: describeRelation(relation) };
  },
};

const unlink: Command = {
  name: 'unlink',
  summary: 'Remove a relation made with "otea link", named the same way',
  args: ['id', 'kind', 'other'],
  options: {},
  execute: (input) => {
    const [id = '', kind = '', other = ''] = input.args;
    const { actor, channel } = input;
    const relation = withAgent(input, (project) =>
      unlinkItems(project, { id, kind, other, actor, channel }),
    );
    return { data: relation, text: `Removed: ${describeRelation(relation)}` };
  },
};

// Kept apart from every other write so a harness can ask the human to confirm each relay.
const relay: Command = {
  name: 'relay',
  summary:
    'Record a decision the human made in conversation: move the item as the human, via you (human transitions only; human-ui ones stay in the web UI)',
  args: ['id', 'state'],
  options: {
    quote: { required: true, placeholder: 'what the human said' },
    reason: {},
    motive: { placeholder: 'name' },
  },
  execute: (input) => {
    const [id = '', to = ''] = input.args;
    const quote = input.required('quote');
    const reason = input.option('reason');
    const motive = input.option('motive');
    const via = input.actor.name;
    const { channel } = input;
    const relayed = {
      id,
      to,
      via,
      channel,
      quote,
      ...(reason ? { reason } : {}),
      ...(motive ? { motive } : {}),
    };
    return withAgent(input, (project) => itemResult(project, relayDecision(project, relayed)));
  },
};

const COUNT_PATTERN = /^\d+$/;

function countFrom(name: string, value: string | undefined, min: number): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!COUNT_PATTERN.test(value) || count < min) {
    throw new UsageError(`--${name} must be an integer of at least ${min}`);
  }
  return count;
}

function eventFilter({ option }: Input): EventFilter {
  const filter: EventFilter = {};
  const item = option('item');
  const collection = option('collection');
  const since = countFrom('since', option('since'), 0);
  const limit = countFrom('limit', option('limit'), 1);
  if (item !== undefined) filter.item = item;
  if (collection !== undefined) filter.collection = collection;
  if (since !== undefined) filter.since = since;
  // After a cursor, --limit pages forward from it; alone, it reads the latest events.
  if (limit !== undefined && since !== undefined) filter.limit = limit;
  if (limit !== undefined && since === undefined) filter.latest = limit;
  return filter;
}

const brief: Command = {
  name: 'brief',
  summary:
    'Print a Markdown brief for the items given, in the order their blocks allow, with its limits (--constraint, repeatable) and success criteria (--success, repeatable), which replace the default lines',
  args: ['ids...'],
  options: {
    constraint: { multiple: true, placeholder: 'text' },
    success: { multiple: true, placeholder: 'text' },
  },
  execute: ({ cwd, args, options }) => {
    const limits = options('constraint');
    const success = options('success');
    const written = withProject(cwd, (project) =>
      briefFor(project, {
        ids: args,
        ...(limits.length > 0 ? { limits } : {}),
        ...(success.length > 0 ? { success } : {}),
      }),
    );
    return { data: written, text: written.markdown.trimEnd() };
  },
};

const events: Command = {
  name: 'events',
  summary:
    'Print the event log in commit order, after the event id given to --since; --limit alone prints the latest n, after --since the first n; --follow keeps printing new events until Ctrl+C',
  args: [],
  options: {
    item: { placeholder: 'id' },
    collection: {},
    since: { placeholder: 'event id' },
    limit: { placeholder: 'n' },
    follow: { flag: true },
  },
  execute: async (input) => {
    const filter = eventFilter(input);
    const follow = input.flag('follow');
    if (follow && (filter.limit ?? filter.latest) !== undefined) {
      throw new UsageError('--limit cannot be combined with --follow');
    }
    await withReaderWhile(input, async (project) => {
      let since = filter.since ?? 0;
      const collectionOf = itemCollections(project);
      const printNew = () => {
        // Read afresh each time: a board published while following names its steps anew.
        const boardOf = boardsOf(project);
        for (const event of listEvents(project, { ...filter, since })) {
          const def = boardOf(collectionOf(event.itemId));
          input.print(eventData(def, event), formatEvent(readableEvent(def, event)));
          since = event.id;
        }
        return undefined;
      };
      printNew();
      if (follow) await watch(project.db, printNew, { signal: input.signal });
    });
    return undefined;
  },
};

// How each model performs: per model family and effort, from the profile on each handoff.
const stats: Command = {
  name: 'stats',
  summary:
    'Print how each model performs on the boards, per model family and effort (and per exact model and step): handoffs, how many came back, rounds per finished step, items done, discards and the median time from claim to handoff; --since 7d, 30d or all (the default), --board keeps one board. Profiles are as the agents declare them',
  args: [],
  options: { board: {}, since: { placeholder: 'period' } },
  execute: ({ cwd, option }) => {
    const board = option('board');
    const since = option('since') ?? 'all';
    const view = withProject(cwd, (project) => performanceOf(project, { board, since }));
    return { data: view, text: statsText(view, since) };
  },
};

function durationFrom(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const bare = name === 'timeout';
  const duration = bare ? parseWaitTimeout(value) : parseDuration(value);
  if (duration === undefined) {
    throw new UsageError(
      `--${name} must be a positive duration such as ${bare ? '600 (seconds), ' : ''}90s, 15m or 1h`,
    );
  }
  return duration;
}

const ttlFrom = (value: string | undefined) => durationFrom('ttl', value);

const TTL = { ttl: { placeholder: 'duration' } };

// A wait ends with the shell that started it, so an agent is never left listening for nobody. It
// says what to do: a `wait &` inside a short command, or a subshell that returns, ends it at once
// (P1-F9, P2-F5); the harness's own background task or shell lasts. docs/agents.md says the same.
const WAIT_ORPHANED =
  "Stopped waiting: the session that started it ended. Run otea wait again from a shell that stays open: your harness's background task or shell, not `&` or a subshell inside a short command, which ends it with that command";

// Lease expiry writes nothing, so a wait for unclaimed items also checks again on this timer.
const LEASE_RECHECK_MS = 1000;

// The secretary's wait also looks for board work that has stayed unheard for the grace, which no
// write announces: it checks again on this timer.
const SECRETARY_RECHECK_MS = 5000;

// How long a secretary wait that already has its answer waits for the process table, to note the
// harness session it runs under.
const HARNESS_READ_MS = 4000;

// Whether the harness session of the agent's waits is noted and still runs, so a wait need not read
// the process table to find it again.
function harnessNoted(cwd: string, agent: string): boolean {
  try {
    return withProject(cwd, (project) => {
      const harness = selectListenerProcesses(project.db).get(agent)?.harness ?? null;
      return harness !== null && processAlive(harness);
    });
  } catch {
    return false;
  }
}

// Runs `look` as a wait: the agent is heard as it waits, so it counts as connected and its profile
// stays confirmed, from the start and on every beat; a wait that ends (it found something, was
// stopped or its session ended) stops its agent waiting at once, and one that timed out leaves it,
// since the agent calls it again.
async function listenWhile<T>(
  project: Project,
  input: Input,
  owner: ReturnType<typeof watchOwner>,
  look: () => T | undefined,
  options: Omit<WatchOptions, 'beat'>,
): Promise<Watched<T>> {
  const me = input.actor.name;
  // When it was last heard: a wait whose session ended stops its agent listening at once.
  let heardAt: string | undefined;
  // On the command line its own process is watched: killed with its session, it leaves its
  // agent counted as gone at once, not a listening window later (P2S-R2-7, P8-R2-7).
  const waiter = input.channel === 'cli' ? { waiter: process.pid } : {};
  const heard =
    input.actor.kind === 'agent'
      ? waitBeat(project.db, {
          agent: me,
          channel: input.channel,
          harness: input.harness,
          ...waiter,
        })
      : undefined;
  const beat = heard
    ? {
        beat: {
          everyMs: heard.everyMs,
          run: () => {
            heardAt = heard.run();
          },
        },
      }
    : {};
  // It listens from the start, not from its first beat.
  beat.beat?.run();
  const waited = await watch(project.db, look, { ...options, ...beat }).finally(() => {
    owner.stop();
    if (heard && input.channel === 'cli') {
      // A wait whose session ended (it saw its owner gone) stays noted, as one killed with
      // it does: its agent's session reads as ended (P3C-R3-11).
      if (!owner.orphaned()) endWaiter(project.db, me, process.pid);
      endProcess(project.db, process.pid);
    }
  });
  if (owner.orphaned() && heardAt) endListening(project.db, me, heardAt);
  // It waits no more once it found something or was stopped; a timeout is called again at once.
  const timedOut = !('found' in waited) && waited.stopped === 'timeout';
  if (heardAt && !timedOut) endWaiting(project.db, me, heardAt);
  return waited;
}

// The secretary's wait (otea wait --secretary): returns for a message from the person, a Bandeja
// capture, a question escalated to it, or board work nobody listens to (app/secretary.ts). Only the
// project's secretary waits this way, and the boards do not count it as listening.
async function waitForSecretary(input: Input): Promise<Output> {
  const { option } = input;
  if (
    option('turn') !== undefined ||
    option('collection') !== undefined ||
    input.flag('unclaimed')
  ) {
    throw new UsageError(
      '--secretary takes no --turn, --collection or --unclaimed: it waits for the person and for the boards nobody listens to',
    );
  }
  const timeout = option('timeout');
  const timeoutMs = durationFrom('timeout', timeout);
  const me = input.actor.name;
  // Its harness session is noted as soon as the processes are read: that is the one process that
  // says the secretary's session ended once no wait of it runs (it works between two waits). Once
  // noted and still running it is not read again by the waits that follow, which stay as quick as
  // before: only the first wait of a session reads the process table early, and a wake that comes
  // before it is done waits for it a few seconds at most.
  const noting = input.channel === 'cli' && !harnessNoted(input.cwd, me);
  const owner = watchOwner(input.signal, { early: noting });
  const options = {
    signal: owner.signal,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    recheckMs: SECRETARY_RECHECK_MS,
  };
  const result = await withAgentWhile(input, async (project) => {
    requireSecretary(project.db, me);
    const noted = owner.harness.then((pid) => {
      if (pid === undefined || pid === process.pid) return;
      try {
        noteHarness(project.db, me, pid);
      } catch {
        // The wait ended and closed the project first: nothing left to note it for.
      }
    });
    // A board the person publishes while it waits joins the catalog before the check reads its items.
    const secretaryWait = startSecretaryWait();
    const look = () => {
      syncBoardPresets(project);
      return secretaryWake(project, secretaryWait);
    };
    const waited = await listenWhile(project, input, owner, look, options);
    // A wake in the first seconds comes before the processes are read: it gives them a moment, as
    // the harness noted is what tells its session ended once this process is gone.
    if (noting && !owner.orphaned())
      await Promise.race([noted, delay(HARNESS_READ_MS, undefined, { ref: false })]);
    if (!('found' in waited)) return waited;
    const wake = waited.found;
    return {
      data: { secretary: me, ...wake },
      text: [wake.text, secretaryWaitAgainLine(me, input.channel)].join('\n'),
    };
  });
  owner.release();
  if ('data' in result) return result;
  if (result.stopped === 'timeout') {
    const within = /^\d+$/.test(timeout ?? '') ? `${timeout}s` : timeout;
    throw new CommandFailure(
      'timeout',
      `Nothing reached the secretary within ${within}; a timeout is no failure, keep waiting: ${secretaryWaitCommand(me)}`,
    );
  }
  if (owner.orphaned()) throw new CommandFailure('interrupted', WAIT_ORPHANED);
  throw new CommandFailure('interrupted', 'Interrupted while waiting');
}

const wait: Command = {
  name: 'wait',
  summary:
    'Wait until an item is on the turn and print it as a list row, at once if one already is; the one waiting longest in its state comes first. A note from the person on an item you hold, or their answer to your question, wakes it too, saying which. --secretary, instead of --turn, is the secretary wait: it wakes for the person, a Bandeja note, an escalated question or board work nobody hears',
  args: [],
  options: {
    // Required unless --secretary: checked in execute.
    turn: { choices: ['agent', 'human'] },
    collection: {},
    unclaimed: { flag: true },
    secretary: { flag: true },
    timeout: { placeholder: 'duration' },
  },
  execute: async (input) => {
    if (input.flag('secretary')) return waitForSecretary(input);
    const turn = input.required('turn');
    const timeout = input.option('timeout');
    const timeoutMs = durationFrom('timeout', timeout);
    const filter = listFilter(input);
    // A wait whose starter is gone (its agent's session ended) stops: left running it would keep
    // the agent shown as listening until its timeout.
    const owner = watchOwner(input.signal);
    const options = {
      signal: owner.signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(filter.availableTo === undefined ? {} : { recheckMs: LEASE_RECHECK_MS }),
    };
    const result = await withAgentWhile(input, async (project) => {
      // A note from the person on an item this agent holds wakes it too: it answers it first. So
      // does the person's answer to its question.
      const me = input.actor.name;
      // An agent waiting for unclaimed agent work wakes only for an item next would offer it: one left for
      // or just offered to another agent would wake it to "nothing to do" again and again.
      const forMe =
        input.actor.kind === 'agent' && turn === 'agent' && filter.availableTo !== undefined;
      // A board the person publishes while it waits joins the catalog before the check reads its
      // items, as the server does on each request; it costs one query when nothing was published.
      const check = () => {
        syncBoardPresets(project);
        return lookFor();
      };
      // Topics the person turns on while an agent waits wake it once with their rule: its session
      // began without it, and an agent at work reads it in next.
      const topicsBefore = topicsGuided(project);
      const topicsTurnedOn = () =>
        input.actor.kind === 'agent' && !topicsBefore && topicsGuided(project)
          ? { topics: 'on', text: `The person turned topics on. ${TOPICS_TEXT}` }
          : undefined;
      // An agent waiting on the agent turn while its own question waits for the person waits for
      // the answer, and for its send-backs and new work; work already free when it asked does not
      // wake it (wakesWhileAsking).
      const onItsQuestion = () =>
        input.actor.kind === 'agent' && turn === 'agent' && askedByAgent(project, me).length > 0;
      const keep = () => {
        const offerable = forMe ? offerableTo(project, me) : undefined;
        const asking =
          input.actor.kind === 'agent' && turn === 'agent'
            ? wakesWhileAsking(project, me)
            : undefined;
        if (!asking) return offerable;
        return (item: Item) => asking(item) && (offerable?.(item) ?? true);
      };
      const lookFor = () =>
        topicsTurnedOn() ??
        noteWaiting(project, me) ??
        (input.actor.kind === 'agent' ? topicWaiting(project, me) : undefined) ??
        answerWaiting(project, me) ??
        oldestWaiting(project, filter, undefined, keep());
      const waited = await listenWhile(project, input, owner, check, options);
      if (!('found' in waited)) {
        return { ...waited, asked: onItsQuestion() ? askedByAgent(project, me) : [] };
      }
      const { found } = waited;
      const row = 'text' in found ? { data: found, text: found.text } : itemResult(project, found);
      // A parent whose parts wait to be merged: the merges are what the agent does now.
      const merges = 'text' in found ? undefined : mergeFirstFor(project, found.id);
      // The item it just let go of: how to set it aside, if the person wants it later (P3C-R3-2).
      const later =
        'text' in found || input.actor.kind !== 'agent'
          ? undefined
          : laterLine(project, found.id, me);
      // That the person took it up again, and their unanswered notes (P7-R3-8, P5-R3-8).
      const woken = 'text' in found ? [] : wokeLines(project, found.id);
      // Without --unclaimed any item on the turn wakes the wait, one another agent holds too (P1-F4):
      // it said nothing of why it came back at once, and read as a wait that does not wait.
      const held =
        'text' in found ||
        input.actor.kind !== 'agent' ||
        turn !== 'agent' ||
        filter.availableTo !== undefined ||
        !found.lease ||
        found.lease.holder === me
          ? undefined
          : `${found.id} is held by ${found.lease.holder} until ${timeText(found.lease.expiresAt)}; this wait wakes for held items too; to wait only for work you can take: ${keepWaitingCommand(me, filter.collection)}`;
      const added = [merges, later, held, ...woken].filter((line) => line !== undefined);
      const woke = added.length === 0 ? row : { ...row, text: [row.text, ...added].join('\n') };
      // While topics are on, what woke the agent reminds it to record side questions.
      const reminded = 'topics' in found ? woke : withTopicsReminder(project, input.actor, woke);
      // An agent woken on its turn reads what woke it, then waits again: told so in exact words.
      if (input.actor.kind !== 'agent' || turn !== 'agent') return reminded;
      return {
        ...reminded,
        text: `${reminded.text}\n${waitAgainLine(me, input.channel, filter.collection)}`,
      };
    });
    if ('data' in result) return result;
    if (result.stopped === 'timeout') {
      const asked = result.asked.join(', ');
      // A bare number of seconds reads back as what it means.
      const within = /^\d+$/.test(timeout ?? '') ? `${timeout}s` : timeout;
      const said =
        asked === ''
          ? `No item reached the ${turn} turn within ${within}`
          : `The person has not answered your question on ${asked} within ${within}`;
      // A timeout is no end of the work: an agent waits again, with the exact command.
      const again =
        input.actor.kind === 'agent' && turn === 'agent'
          ? `; a timeout is no failure, keep waiting: ${keepWaitingCommand(input.actor.name, filter.collection, filter.availableTo !== undefined)}`
          : '';
      throw new CommandFailure('timeout', `${said}${again}`);
    }
    if (owner.orphaned()) {
      throw new CommandFailure('interrupted', WAIT_ORPHANED);
    }
    throw new CommandFailure('interrupted', 'Interrupted while waiting');
  },
};

// The notice an agent reads on next and claim when the checkout it works in had a remote added
// after Otea saw it: its pushes are refused until the person says it is that repo (P3-F1). Never
// breaks the command it rides on.
function remoteAddedNotice(project: Project, cwd: string): string | undefined {
  try {
    return remoteAddedLine(project, cwd);
  } catch {
    return undefined;
  }
}

// An agent that claims, or is offered, an item in the repo's main checkout is told to work in its
// own worktree (P1-15, P6-R2-3) while other agents hold work in the project (two agents in one
// checkout change each other's files), or while that checkout sits on another open item's branch
// (switching it here changes that item's work, as Integrar left it twice).
function sharedCheckoutLine(project: Project, input: Input, id?: string): string | undefined {
  if (!inMainCheckout(input.cwd)) return undefined;
  const me = input.actor.name;
  const others = [
    ...new Set(
      listAgents(project.db)
        .filter((agent) => agent.name !== me && agent.holding.length > 0)
        .map(({ name }) => name),
    ),
  ];
  let on: string | undefined;
  try {
    on = currentBranch(input.cwd);
  } catch {}
  const holder = on === undefined ? undefined : openItemOn(project, on, id);
  const lines: string[] = [];
  if (holder && on) {
    lines.push(
      `This is the repository's main checkout, and it is on ${on}, the branch of ${holder}: do ${id ?? 'this item'} in its own git worktree (git worktree add ../<folder> -b <branch>) and leave ${holder}'s branch as it is.`,
    );
  }
  // On a board that works straight on its base, the work is on main with no branch, and Otea lets
  // one change at a time on it, held until it has landed (land-order.ts): a worktree of its own
  // would only move the work off the base the person reviews, so the notice must not send the agent
  // to one (P1-F2). It says only what the rule makes true: no other item of the boards that work on
  // this base is on it. Agents with other work (another board, another repo) may still be in this
  // checkout, so it says to keep to the files of the change.
  const board =
    id === undefined ? undefined : liveBoardOf(project, getItem(project, id).collection);
  const base = board && workedBase(board.def);
  if (base !== undefined && others.length > 0) {
    lines.push(
      `${others.join(', ')} also holds work in this project, but this board works straight on ${base}, one change at a time until it has landed, so no other item of it is on ${base} while you hold ${id}: work here, on ${base}, with no branch and no worktree, and touch only the files of your change.`,
    );
  } else if (others.length > 0) {
    lines.push(
      `${others.join(', ')} also holds work in this project, and you are in the repository's main checkout: do your work on your own branch in your own git worktree (git worktree add ../<folder> -b <branch>), never in files another agent is changing.`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

// The open board item, other than `except`, whose protected branch is `branch` (never a base a
// board protects: the base is every item's).
function openItemOn(project: Project, branch: string, except?: string): string | undefined {
  for (const board of liveBoards(project)) {
    const guard = guardedBranch(board.def);
    if (!guard || guard.guard.base === branch) continue;
    const found = listItems(project, { collection: board.collection }).find(
      (item) =>
        item.id !== except &&
        !isClosed(positionOf(item.state)) &&
        String(item.fields[guard.id] ?? '').trim() === branch,
    );
    if (found) return found.id;
  }
  return undefined;
}

const claim: Command = {
  name: 'claim',
  summary:
    'Hold an item on the agent turn so no other agent can write it (default --ttl 15m); claiming it again extends it',
  args: ['id'],
  options: TTL,
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor, option } = input;
    const ttl = ttlFrom(option('ttl'));
    const lease = { id, actor, ...(ttl === undefined ? {} : { ttlMs: ttl }) };
    return withAgent(input, (project) => {
      requireProfile(project.db, actor.name, { channel: input.channel });
      const item = claimItem(project, {
        ...lease,
        baseTipsOf: claimedBaseTips(project, input.cwd),
      });
      const claimed = itemResult(project, item);
      // P3C-R3-11: the lease of an agent whose session ended is taken over, and said.
      const over = item.tookOver
        ? `Took ${item.id} over from ${item.tookOver}: its session ended (no MCP server or wait of it runs), so its lease was yours to take.`
        : undefined;
      const shared = sharedCheckoutLine(project, input, id);
      const remote = remoteAddedNotice(project, input.cwd);
      const lines = [claimed.text, over, shared, remote].filter((line) => line !== undefined);
      const text = lines.join('\n');
      // The notices ride in data.text, as next's do, so they survive --json (a program reads data).
      const noticed = over || shared || remote ? { text } : {};
      return {
        data: {
          ...(claimed.data as object),
          ...(item.tookOver ? { tookOver: item.tookOver } : {}),
          ...noticed,
        },
        text,
      };
    });
  },
};

// How the name whoami gives back came through: the harness the session named, another one it is
// known by, or one nobody knows (an agent seen only on the command line).
function throughText({ harness, sameHarness }: NameAdvice): string {
  if (sameHarness) return 'through this harness';
  return harness === null ? '(its harness is not known)' : `through ${harness}`;
}

// The name a session takes: the one it worked under before here (same folder, same harness, not
// connected now), so it keeps one name across sessions; else a new one, never one connected now.
const whoami: Command = {
  name: 'whoami',
  summary:
    'Say which agent name to use in this session: the one you worked under before from this folder through the same harness (and not connected now), or that you pick a new one, not one of the agents connected now. --harness names the tool you run in (an MCP client names its own)',
  args: [],
  options: { harness: { placeholder: 'name' } },
  execute: (input) => {
    const { cwd, option } = input;
    const client = input.channel === 'mcp' ? input.harness?.name : undefined;
    const harness = option('harness') ?? client;
    return withProject(cwd, (project) => {
      const told = nameTold(project, input, harness);
      const name = told.data.given ? input.agent : (told.data.name ?? told.data.suggested);
      const lines = [...openDraftLines(project, name ?? null), ...secretaryLines(project, name)];
      return lines.length === 0 ? told : { ...told, text: [told.text, ...lines].join('\n') };
    });
  },
};

// Who the project's secretary is and where it stands, when it has one: the agent told it is the
// secretary says how to listen.
function secretaryLines(project: Project, name: string | undefined | null): string[] {
  const secretary = secretaryStatus(project.db);
  if (secretary === undefined) return [];
  const stands =
    secretary.state === 'offline'
      ? `offline since ${secretary.since === null ? 'never heard' : timeText(secretary.since)}`
      : secretary.state;
  if (secretary.name === name) {
    return [
      `You are this project's secretary (${stands}). Listen for the person with ${secretaryWaitCommand(name)}; read what they wrote with otea conversation --as ${name}, answer with otea say.`,
    ];
  }
  return [`This project's secretary is ${secretary.name} (${stands}).`];
}

// A board draft a restart may have cut off (p3-company run 2): Otea kept it, and a new session is
// pointed to it, the command to carry it on with when the name it takes is the one holding it.
function openDraftLines(project: Project, name: string | null): string[] {
  return openDraftsOf(project, systemClock()).map(({ item, name: board, holder }) => {
    const held = holder === null ? '' : `, held by ${holder}`;
    if (holder !== null && holder !== name)
      return `A board draft is open on ${item}, "${board}"${held}.`;
    return `A board draft is open on ${item}, "${board}"${held}: Otea kept it as it was. If you were drafting it, carry it on: otea show ${item} --as ${name ?? '<name>'} says how to hand it in.`;
  });
}

// The items a name handed back still holds from its last session.
function heldLine(name: string, ids: readonly string[]): string {
  const one = ids.length === 1;
  const release = one ? `otea release ${ids[0]}` : 'otea release <id>';
  return `${name} holds ${ids.join(', ')} from its last session: carry ${one ? 'it' : 'them'} on (otea next) or let go of ${one ? 'it' : 'them'} (${release}).`;
}

// What whoami tells the session about its name.
function nameTold(
  project: Project,
  input: Input,
  harness: string | undefined,
): { data: NameAdvice & { given?: boolean; reuse?: boolean }; text: string } {
  const { cwd } = input;
  // Over MCP this server asks: a name it hears is this session's own.
  const session = input.channel === 'mcp' ? process.pid : undefined;
  if (input.agent !== undefined) {
    assertAgentName(input.agent);
    const advice = nameFor(project.db, { folder: cwd, harness, session });
    return {
      data: { ...advice, name: input.agent, given: true },
      text: `You are ${input.agent}: put it on every command (--as ${input.agent}; MCP tools: as).`,
    };
  }
  // The name it is told is handed to this session: one asking at the same time gets another.
  const advice = offerName(project.db, { folder: cwd, harness, session });
  const others = advice.others.length > 0 ? advice.others : [];
  if (advice.name !== null) {
    const known = findAgent(project.db, advice.name);
    const when = known ? ` (last seen ${timeText(known.lastSeen)})` : '';
    return {
      data: { ...advice, reuse: true },
      text: [
        `Reuse your name: ${advice.name}${when}, the agent that worked here before ${throughText(advice)}, with no session working under it now. Put it on every command: --as ${advice.name} (MCP tools: as).`,
        ...(advice.lately
          ? [
              `${advice.name} acted moments ago: keep the name unless you know another terminal of yours works as ${advice.name} now; then take a new name of your own. Decide it yourself: never ask the person which name to use.`,
            ]
          : []),
        // What its last session left held is this one's to carry on (P7-R3-11).
        ...(advice.holding.length > 0 ? [heldLine(advice.name, advice.holding)] : []),
        ...(others.length > 0
          ? [`Others that worked here and are not connected now: ${others.join(', ')}.`]
          : []),
      ].join('\n'),
    };
  }
  if (advice.suggested !== null) {
    const name = advice.suggested;
    return {
      data: { ...advice, reuse: false },
      text: `Take the name ${name}: your earlier name here is taken by a session working now, and ${name} is handed to this session only. Put it on every command: --as ${name} (MCP tools: as).`,
    };
  }
  const taken =
    advice.working.length > 0
      ? `, not one of the agents connected now (${advice.working.join(', ')})`
      : '';
  return {
    data: { ...advice, reuse: false },
    text: `No earlier session of yours is known here: pick a new short name of your own (lowercase letters, digits and dashes)${taken}, and put it on every command (--as <name>; MCP tools: as).`,
  };
}

// Declares the agent's profile from --model and --effort (what it already declared fills the one
// left out; the first time both are needed).
function declareFromOptions(
  { actor, channel, harness }: Pick<Input, 'actor' | 'channel' | 'harness'>,
  project: Project,
  {
    model,
    effort,
    given,
  }: { model?: string | undefined; effort?: string | undefined; given?: string | undefined },
): DeclaredProfileView {
  const known = findProfile(project.db, actor.name);
  const declaredModel = model ?? known?.profile.model;
  const declaredEffort = effort ?? known?.profile.effort;
  if (declaredModel === undefined || declaredEffort === undefined) {
    throw new UsageError('Declare both --model <id> and --effort <level> the first time');
  }
  return declareProfile(project.db, {
    agent: actor.name,
    channel,
    harness,
    model: declaredModel,
    effort: declaredEffort,
    ...(given === undefined ? {} : { given }),
  });
}

// The profile an agent runs as: declared with --model and --effort (--harness too for a
// command-line agent the first time; an MCP client names its own), or shown without them.
const profileCommandSpec: Command = {
  name: 'profile',
  summary:
    'Declare the profile you run as: --model the exact model id and --effort the effort, as your harness names them (such as claude-opus-5-5 and high). Declare what this session tells you (your instructions, or what the person says); never open config files outside the project for it. Otherwise declare unknown. Never guess. --harness the tool you run in, the first time on the command line (an MCP client names its own). Declare it at the start of each session and whenever the model or effort changes; it is kept on everything you do. Without options, shows it',
  args: [],
  options: {
    model: { placeholder: 'id' },
    effort: { placeholder: 'level' },
    harness: { placeholder: 'name' },
    role: { choices: AGENT_ROLES, about: ROLE_ABOUT },
  },
  execute: (input) => {
    const { actor, channel, option } = input;
    const model = option('model');
    const effort = option('effort');
    const given = option('harness');
    const role = option('role');
    return withAgent(input, (project) => {
      // The secretary role first: refused (a project has one), nothing else is declared.
      const roled = role === undefined ? undefined : declareSecretary(project.db, actor.name);
      const known = findProfile(project.db, actor.name);
      const out = ((): Output => {
        if (model === undefined && effort === undefined && given === undefined) {
          if (!known) {
            const text = `${actor.name} has no profile yet: declare it with ${profileCommand(actor.name, channel)}`;
            return { data: { agent: actor.name, profile: null, confirmed: false }, text };
          }
          const view = profileView(known.profile);
          return {
            data: { agent: actor.name, profile: view, confirmed: known.confirmed },
            text: profileText(actor.name, view, known.confirmed, channel),
          };
        }
        const declared = declareFromOptions(input, project, { model, effort, given });
        return { data: declared, text: profileText(actor.name, declared.profile, true, channel) };
      })();
      if (roled === undefined) return out;
      return {
        data: { ...(out.data as object), role: roled.role, replaced: roled.replaced },
        text: `${out.text}\n${secretaryRoleLine(actor.name, roled.replaced)}`,
      };
    });
  },
};

// What declaring the role says: the project's secretary, whom it replaced, and how it listens.
function secretaryRoleLine(agent: string, replaced: string | null) {
  const was = replaced === null ? '' : ` (it replaces ${replaced}, which is gone)`;
  return `${agent} is this project's secretary${was}. Listen for the person with ${secretaryWaitCommand(agent)}, in the background if you can; the secretary never waits with --turn.`;
}

function profileText(
  agent: string,
  profile: ProfileView,
  confirmed: boolean,
  channel: Input['channel'],
): string {
  const line = `${agent} runs as ${profileLine(profile)} on ${profile.harness} (family ${profile.family})`;
  return confirmed
    ? line
    : `${line}; not confirmed in this session: declare it again with ${profileCommand(agent, channel)}`;
}

const heartbeat: Command = {
  name: 'heartbeat',
  summary: 'Extend the lease you hold on an item (default --ttl 15m from now)',
  args: ['id'],
  options: TTL,
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor, option } = input;
    const ttl = ttlFrom(option('ttl'));
    const lease = { id, actor, ...(ttl === undefined ? {} : { ttlMs: ttl }) };
    return withAgent(input, (project) =>
      withNotes(project, id, itemResult(project, heartbeatItem(project, lease))),
    );
  },
};

// What an agent's answer adds while notes from the person wait for its answer: their block after
// the text, and the notes and that block in the data (`notes`, `text`).
function withNotes(project: Project, id: string, output: Output): Output {
  const waiting = agentNotes(project, id);
  if (!waiting) return output;
  return {
    data: { ...(output.data as Record<string, unknown>), notes: waiting.notes, text: waiting.text },
    text: `${output.text}\n\n${waiting.text}`,
  };
}

// What a note's number is, and what a send-back reason is instead (P2S-R3-5): an agent tried to
// answer a send-back reason with reply, as if it were a note.
const SEND_BACK_IS_NO_NOTE =
  'A send-back reason is not a note: address it in your work, then say what you did in the note of your next handoff (otea handoff <id> --note "...")';
// In every MCP agent's tool list: kept short (token-budget.test.ts).
const NOTE_ABOUT =
  "the number of the person's note you answer. A send-back reason is not a note: answer it in your next handoff's note";

const reply: Command = {
  name: 'reply',
  summary:
    'Answer a note the person left while you do a step (--note, its number; next, show and heartbeat print them): a short answer; the step, round and lease stay as they are. A handoff waits until every note of the round is answered',
  args: ['id', 'answer'],
  options: { note: { required: true, placeholder: 'n', about: NOTE_ABOUT } },
  execute: (input) => {
    const [id = '', answer = ''] = input.args;
    const given = input.required('note');
    if (!/^[1-9]\d*$/.test(given))
      throw new UsageError(
        `--note must be the number of one of the person's notes (next, show and heartbeat print each with its number). ${SEND_BACK_IS_NO_NOTE}`,
      );
    const { actor, channel } = input;
    return withAgent(input, (project) => {
      const replied = replyNote(project, { id, note: Number(given), text: answer, actor, channel });
      const next = keepWaitingLine(actor.name, channel, { idle: false });
      return { data: { ...replied, next }, text: [replied.text, next].join('\n') };
    });
  },
};

// The zone of an image a note is on, cut out for an agent that asks for it: the note says the zone
// in percent; this gives its pixels, and for a PNG the pixels themselves in a file.
const crop: Command = {
  name: 'crop',
  summary:
    'Cut out the zone of an image a note of the person is on (--note, its number; a note on a point gives a fifth of the image around it): a PNG is written to a file (--out, or the temp folder) to read as an image; any other image gets the zone in its pixels',
  args: ['id'],
  options: { note: { required: true, placeholder: 'n' }, out: { placeholder: 'file.png' } },
  execute: (input) => {
    const [id = ''] = input.args;
    const given = input.required('note');
    if (!/^[1-9]\d*$/.test(given)) throw new UsageError('--note must be the number of a note');
    const out = input.option('out');
    return withAgent(input, (project) => {
      const cut = cropNote(project, {
        id,
        note: Number(given),
        ...(out === undefined ? {} : { out }),
      });
      return { data: cut, text: cut.text };
    });
  },
};

// That a Done item's branch is in: Done takes no other change, so this is how its page and rows
// learn the work was merged.
const merged: Command = {
  name: 'merged',
  summary:
    "Record that a Done item's branch was merged (--pr, its pull request; --commit, the merge commit), so its page and rows stop saying it waits to be merged",
  args: ['id'],
  options: { pr: { placeholder: 'url' }, commit: { placeholder: 'sha' } },
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor, channel } = input;
    const pr = input.option('pr');
    const commit = input.option('commit');
    // With a PR, gh says whether it really merged and which branch: a wrong mark is refused. When
    // gh cannot tell, the mark is kept as given, with a note.
    const forge = pr === undefined ? undefined : prState(input.cwd, pr, input.gh);
    if (pr !== undefined && forge === undefined)
      input.warn(`could not check PR ${pr} with gh; recorded as merged as you said`);
    return withAgent(input, (project) => {
      const done = markMerged(project, {
        id,
        actor,
        channel,
        ...(pr === undefined ? {} : { pr }),
        ...(commit === undefined ? {} : { commit }),
        ...(forge === undefined ? {} : { forge }),
      });
      const said = [done.pr, done.commit].filter(Boolean).join(', ');
      return { data: done, text: `Marked ${id} merged${said ? ` (${said})` : ''}.` };
    });
  },
};

const reopen: Command = {
  name: 'reopen',
  summary:
    'Take a Done, unmerged item back to the step that pushes its branch (its PR conflicts) and through review again',
  args: ['id'],
  options: { reason: { placeholder: 'why its branch must change' } },
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor, channel } = input;
    const reason = input.option('reason') ?? '';
    return withAgent(input, (project) => {
      const { item, text } = reopenItem(project, { id, actor, channel, reason });
      // As any move answers: the item with its fields by name, and what to do now.
      return { data: { item: itemData(project, item), text }, text };
    });
  },
};

// The proof a tick names: an evidence entry (--evidence 3), a log line (--log build.log:212) or a
// test of an attached report (--test "suite › name"); at most one.
function proofSource(option: (name: string) => string | undefined): ProofSource {
  const evidence = option('evidence');
  const log = option('log');
  const test = option('test');
  const given = [evidence, log, test].filter((value) => value !== undefined);
  if (given.length > 1)
    throw new OteaError('invalid_fields', 'Prove a point with one of --evidence, --log or --test');
  if (evidence !== undefined) {
    const n = Number(evidence.replace(/^#/, ''));
    if (!Number.isInteger(n) || n < 1)
      throw new OteaError(
        'invalid_fields',
        '--evidence takes the number of an attached file, such as 3',
      );
    return { evidence: n };
  }
  if (log !== undefined) {
    const at = /^(.+):(\d+)$/.exec(log.trim());
    if (!at?.[1] || !at[2])
      throw new OteaError(
        'invalid_fields',
        "--log takes the log's file name and a line, such as build.log:212",
      );
    return { log: { file: at[1], line: Number(at[2]) } };
  }
  if (test !== undefined) return { test };
  return {};
}

// Ticks a checklist point, with what proves it: Otea checks the log line exists and the test passes.
const tick: Command = {
  name: 'tick',
  summary:
    'Tick a checklist point with its proof: --log file:line, --test "name" (passing, in an attached report) or --evidence n; --part names the checklist',
  args: ['id', 'point'],
  options: {
    part: { placeholder: 'checklist' },
    log: { placeholder: 'file:line' },
    test: { placeholder: 'name' },
    evidence: { placeholder: 'n' },
  },
  execute: (input) => {
    const [id = '', point = ''] = input.args;
    const { actor, channel, option } = input;
    const part = option('part');
    const source = proofSource(option);
    return withAgent(input, (project) => {
      const done = tickPoint(project, {
        id,
        point,
        source,
        actor,
        channel,
        ...(part === undefined ? {} : { part }),
      });
      return withNotes(project, id, { data: done, text: done.text });
    });
  },
};

// An agent's question to the person: the turn is theirs until they answer, nothing else moves.
const ask: Command = {
  name: 'ask',
  summary:
    'Ask the person a question while you do a step: the turn is theirs until they answer (the step, round and lease stay); wait wakes on the answer, and next and show give it. Offer 2 to 4 short --option answers to tap, and --recommend the one you would choose. On a Bandeja entry you hold (B-3 for the id) it asks what the note lacks',
  args: ['id', 'question'],
  options: {
    option: { multiple: true, placeholder: 'text', about: '2 to 4 answers to tap' },
    recommend: { placeholder: 'n', about: 'number (from 1) of the one you would choose' },
  },
  execute: (input) => {
    const [id = '', question = ''] = input.args;
    const { actor, channel } = input;
    const options = input.options('option');
    const given = input.option('recommend');
    const recommended = given === undefined ? undefined : Number(given.replace(/^#/, ''));
    if (recommended !== undefined && !Number.isInteger(recommended))
      throw new UsageError('--recommend is the number of an option, from 1');
    return withAgent(input, (project) => {
      // A question on a Bandeja entry the refiner holds (B-3), not on an item.
      if (isBandejaRef(id)) {
        const { entry, question: asked } = askOnBandeja(project, {
          id: bandejaIdOf(id),
          agent: actor.name,
          text: question,
          ...(options.length === 0 ? {} : { options }),
          ...(recommended === undefined ? {} : { recommended }),
        });
        return {
          data: { entry, question: asked },
          text: `Asked the person on ${entry.ref}: it waits for their answer, and your hold on it ends. They tap or write it on the desk (Hablar, the Bandeja). The secretary's wait returns ${entry.ref} once they answer; take it again then (otea bandeja take ${entry.ref} --as ${actor.name}) and read the answer: otea bandeja ${entry.ref} --as ${actor.name}.`,
        };
      }
      const asked = askQuestion(project, {
        id,
        text: question,
        ...(options.length === 0 ? {} : { options }),
        ...(recommended === undefined ? {} : { recommended }),
        actor,
        channel,
      });
      return { data: asked, text: asked.text };
    });
  },
};

// The answer the person gave in the chat to the agent's question, put on the question as theirs.
const answer: Command = {
  name: 'answer',
  summary:
    "Note on your question (otea ask) the person's answer given in the chat, in their words: it counts as theirs",
  args: ['id', 'answer'],
  options: {},
  execute: (input) => {
    const [id = '', text = ''] = input.args;
    const { actor, channel } = input;
    return withAgent(input, (project) => {
      const noted = noteChatAnswer(project, { id, text, actor, channel });
      // It ends with the exact wait: after a chat answer an agent said it waited, running no
      // wait (P3C-R3-9).
      const next = keepWaitingLine(actor.name, channel, { idle: false });
      return { data: { ...noted, next }, text: [noted.text, next].join('\n') };
    });
  },
};

const release: Command = {
  name: 'release',
  summary:
    'Drop the lease you hold on an item; moving it off the agent turn releases it too. --later sets it aside for every agent (next and wait skip it), held or let go of, until it moves, is claimed or the person takes it up',
  args: ['id'],
  options: { later: { flag: true }, quote: { placeholder: "the person's words" } },
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor } = input;
    const later = input.flag('later');
    const quote = input.option('quote');
    if (quote !== undefined && !later) throw new UsageError('--quote goes with --later');
    return withAgent(input, (project) => {
      const item = releaseItem(project, {
        id,
        actor,
        later,
        ...(quote === undefined ? {} : { quote }),
      });
      const released = itemResult(project, item);
      if (!later) return released;
      const aside = `Set ${item.id} aside for every agent: otea next and otea wait --unclaimed leave it out until it moves, an agent claims it (otea claim ${item.id}), or the person takes it up again.`;
      return { ...released, text: `${released.text}\n${aside}` };
    });
  },
};

const validate: Command = {
  name: 'validate',
  summary:
    'Check boards, collections and items without fixing anything; fails only on errors, not warnings',
  args: [],
  options: {},
  execute: ({ cwd }) => {
    const report = withProject(cwd, (project) => validateProject(project));
    const failure = report.errors > 0 ? ('validation_failed' as const) : undefined;
    return { data: report, text: formatReport(report), ...(failure ? { failure } : {}) };
  },
};

const update: Command = {
  name: 'update',
  summary:
    'Change fields of an open item; a blank value clears a field that is not create-required',
  details: FIELD_DETAILS,
  args: ['id'],
  options: {
    title: {},
    description: {},
    field: { multiple: true, placeholder: 'key=value' },
    'field-file': FIELD_FILE,
  },
  execute: async (input) => {
    const [id = ''] = input.args;
    const title = input.option('title');
    const fields = await fieldsFrom(input);
    if (title === undefined && Object.keys(fields).length === 0) {
      throw new UsageError(
        'Nothing to update; pass --title, --description, --field or --field-file',
      );
    }
    const { actor } = input;
    const changes = { id, fields, actor, ...(title === undefined ? {} : { title }) };
    return withAgent(input, (project) => {
      refuseAttachedParts(project, id, Object.keys(fields), input);
      return itemResult(project, updateItem(project, changes));
    });
  },
};

// A part the agent attaches as a file, named as a field to fill (P3C-R3-5): refused with the exact
// otea attach command, the file the agent gave with --field-file in it.
function refuseAttachedParts(
  project: Project,
  id: string,
  keys: readonly string[],
  input: Input,
): void {
  const board = liveBoardOf(project, getItem(project, id).collection);
  if (!board) return;
  const files = new Map(
    input.options('field-file').map((pair) => fieldPair(pair, '', 'field-file', '<file>')),
  );
  for (const key of keys) {
    const part = partByName(board.def, key);
    if (!part || !isEvidence(part)) continue;
    const file = files.get(key);
    throw attachedPart(part, id, file === undefined || file === '-' ? undefined : file);
  }
}

// A diagram Otea cannot draw (outside its Mermaid flowchart subset, core/diagram.ts) is kept, and
// the person sees its source: the agent is told, with the subset, so it can attach one that draws.
function diagramNote(path: string, { filename }: { filename: string }): string {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  const parsed = parseDiagram(source);
  if (parsed.ok) return '';
  return `\nOtea cannot draw ${filename} (line ${parsed.line}: ${parsed.message}): the person sees its source. It draws a Mermaid flowchart: flowchart or graph LR|TD|RL|BT first, then nodes id[label], id(label) or id{label} joined by -->, ---, -.-> or ==> (with |label|); attach a version that keeps to it.`;
}

const attach: Command = {
  name: 'attach',
  summary: `Attach a file to an open item as evidence (at most ${MAX_EVIDENCE_MB} MB), into an evidence module of its type that accepts it; --module picks one when several do, --role before and after fill a compare; --point ticks that checklist point with it`,
  args: ['id', 'file'],
  options: {
    role: { choices: EVIDENCE_ROLES },
    module: { placeholder: 'id' },
    caption: { placeholder: 'text' },
    point: { placeholder: 'checklist point' },
  },
  execute: (input) => {
    const [id = '', file = ''] = input.args;
    const { cwd, actor, channel, option } = input;
    const role = option('role') as EvidenceRole | undefined;
    const module = option('module');
    const caption = option('caption');
    const evidenceInput = {
      id,
      path: resolve(cwd, file),
      actor,
      channel,
      ...(role === undefined ? {} : { role }),
      ...(module === undefined ? {} : { module }),
      ...(caption === undefined ? {} : { caption }),
    };
    return withAgent(input, (project) => {
      const evidence = attachEvidence(project, evidenceInput);
      // On a board, the evidence goes by its name, never its hidden id.
      const board = liveBoardOf(project, getItem(project, evidence.itemId).collection);
      const name = evidence.module === null ? undefined : board?.def.parts[evidence.module]?.name;
      const shown = name === undefined ? evidence : { ...evidence, module: name };
      const same = evidence.duplicate
        ? `\n${evidence.itemId} already has this file as #${evidence.id}; nothing added.`
        : '';
      const data = name === undefined ? evidence : { ...evidence, moduleName: name };
      const point = option('point');
      const ticked =
        point === undefined
          ? undefined
          : tickPoint(project, { id, point, source: { evidence: evidence.id }, actor, channel });
      const drawn = evidence.kind === 'diagram' ? diagramNote(evidenceInput.path, evidence) : '';
      const diff = evidence.diffNote === undefined ? '' : `\n${evidence.diffNote}`;
      const text = `${formatEvidence(shown)}${same}${diff}${drawn}${ticked ? `\n${ticked.text}` : ''}`;
      return withNotes(project, evidence.itemId, {
        // --json and MCP read the diagram's refusal to be drawn too.
        data: {
          ...data,
          ...(ticked ? { ticked } : {}),
          ...(drawn ? { cannotDraw: drawn.trim() } : {}),
        },
        text,
      });
    });
  },
};

// A file attached by mistake, taken back before the item moves on (AGENTS3-4).
const detach: Command = {
  name: 'detach',
  summary:
    'Take back a file you attached by mistake (its number in show), before the item moves on',
  args: ['id', 'evidence'],
  options: {},
  execute: (input) => {
    const [id = '', number = ''] = input.args;
    const evidence = Number(number.replace(/^#/, ''));
    if (!Number.isInteger(evidence) || evidence < 1) {
      throw new UsageError(
        `Not a file number: ${number}. Pass the number show gives it, such as 3`,
      );
    }
    const { actor, channel } = input;
    return withAgent(input, (project) => {
      const entry = detachEvidence(project, { id, evidence, actor, channel });
      const text = `Detached #${entry.id} ${entry.filename} from ${entry.itemId}.`;
      return { data: { ...entry, detached: true }, text };
    });
  },
};

// Phone access, when a door is open: the chosen transport, the URLs a phone opens on it (on the
// local network the .local name first when it resolves; on Tailscale its HTTPS name), the first
// pairing code, and on the local network the same pairing link by IP when the first is a name.
type PhoneServed = {
  transport: TransportKind;
  urls: string[];
  pairingUrl: string | undefined;
  byAddress?: string;
  code: string | undefined;
};

// `url`: the page of the project the command ran in (or the server's home outside any project);
// `attached`: another otea serve was running already, and this one only pointed at it.
type Served = { url: string; signInUrl: string; attached?: true; phone?: PhoneServed };

type ServeOptions = {
  port: number;
  lan: boolean;
  // Started by otea serve start: nobody reads this process's output and nobody is there to watch a
  // network listener, so it neither opens the local network at start nor issues a pairing code.
  unattended: boolean;
  // Started by the desktop app, which owns this server: otea serve stop leaves it alone, and no
  // command tells anyone to stop it.
  desktop: boolean;
  tailscale: TailscaleCli;
  probe: Probe;
  warn: Input['warn'];
  // How a git hook the desk writes runs this Otea again (Publicar's offer), as hook install --git.
  gitHook: Launcher;
};

// The project the command runs in, when there is one; a local one is remembered for the server to
// serve (a registered one it finds in the registry). Its database is closed again: the server
// opens its own.
function projectHere(cwd: string): { id: string } | undefined {
  let project: Project;
  try {
    project = openProject(cwd);
  } catch (error) {
    if (error instanceof OteaError && error.details?.kind === 'no_project') return undefined;
    throw error;
  }
  try {
    const { id } = project.identity;
    if (project.storage === 'local') {
      withMachine(process.env, (machine) =>
        rememberLocalProject(machine, { id, root: project.root }),
      );
    }
    return { id };
  } finally {
    project.db.close();
  }
}

// The page to open, and the sign-in link that lands on it.
function pages(url: string, token: string, here: { id: string } | undefined) {
  const next = here === undefined ? '/' : `/p/${here.id}/`;
  return {
    url: `${url}${next}`,
    signInUrl: `${url}/auth?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`,
  };
}

// This computer's otea serve, when one runs and answers with this Otea home's key.
async function runningServer(home: string): Promise<{ url: string; token: string } | undefined> {
  const state = await inspectServer(home);
  return state.kind === 'running' ? { url: state.url, token: state.token } : undefined;
}

// How often the server looks for projects registered (or served) since it started, so each one's
// notices go out without waiting for a page to open it.
const SYNC_EVERY_MS = 10_000;

async function serveUntil(
  signal: AbortSignal,
  cwd: string,
  options: ServeOptions,
): Promise<Served> {
  const { port, lan, unattended, desktop, tailscale, probe, warn, gitHook } = options;
  const here = projectHere(cwd);
  const home = oteaHome();
  // One server per Otea home: a second otea serve points at the one running.
  const running = await runningServer(home);
  if (running) return { ...pages(running.url, running.token, here), attached: true };
  const token = ensureUiToken(home, { warn });
  const machine = openMachine();
  const source = machineProjects(process.env, machine);
  // The web server's modules load only here, so every other command starts without them.
  const [{ createServer }, { listen, localNetwork }, { pairingUrl }] = await Promise.all([
    import('../server/server.ts'),
    import('../server/listen.ts'),
    import('../server/pairing.ts'),
  ]);
  try {
    const server = createServer(source, {
      token,
      redeemSignInLink: (given) => redeemSignInLink(home, given),
      machine,
      computer: hostname(),
      tailscale,
      probe,
      // The server's own key pair for Web Push, kept beside the UI token.
      // Each push's outcome in this output (the device id, never its endpoint), so a phone that
      // never hears one says why.
      notify: {
        keys: ensureVapidKeys(home, { warn }),
        log: (line) => process.stdout.write(`${line}\n`),
      },
      network: localNetwork,
      gitHook,
    });
    const listening = await listen(server, port);
    // Open to the local network when it was left open (Settings › Phone, otea phone lan --open),
    // or for this run only with --lan; if it cannot open, Otea still serves this computer.
    if (lan || (!unattended && lanOpen(machine))) {
      await server.lan.open().catch((error: unknown) => {
        warn(`Could not open Otea to the local network: ${(error as Error).message}`);
      });
    }
    writeServeFile(
      home,
      {
        port: listening.port,
        pid: process.pid,
        links: true,
        version: OTEA_VERSION,
        owner: unattended ? 'daemon' : desktop ? 'desktop' : 'foreground',
      },
      unattended && port !== 0,
    );
    const sync = setInterval(() => server.sync(), SYNC_EVERY_MS);
    sync.unref();
    const stop = () => {
      clearInterval(sync);
      removeServeFile(home, process.pid);
      return listening.close().finally(() => machine.close());
    };
    signal.addEventListener('abort', stop, { once: true });
    const served = pages(listening.url, token, here);
    const door = server.phone.chosen();
    if (!door || unattended) return served;
    const urls = door.urls(listening.port);
    const code = server.phone.codes.issue();
    const first = urls[0];
    // The .local name comes first when it resolves; the same link by IP comes along.
    const byIp = urls.find((url) => !new URL(url).hostname.endsWith('.local'));
    const byAddress =
      door.kind === 'lan' && first !== byIp && byIp !== undefined
        ? { byAddress: pairingUrl(byIp, code) }
        : {};
    return {
      ...served,
      phone: {
        transport: door.kind,
        urls,
        pairingUrl: first === undefined ? undefined : pairingUrl(first, code),
        ...byAddress,
        code: first === undefined ? undefined : formatCode(code.code),
      },
    };
  } catch (error) {
    source.close();
    machine.close();
    throw error;
  }
}

function phoneText(phone: PhoneServed): string {
  if (phone.pairingUrl === undefined) {
    return 'LAN access is on, but this computer has no private network address a phone could reach';
  }
  const where =
    phone.transport === 'tailscale'
      ? `Phone access through Tailscale: ${phone.urls.join(', ')} (your tailnet's devices only; if a phone cannot open it, run otea phone tailscale)`
      : `LAN access on: ${phone.urls.join(', ')} (same network only; otea phone tailscale reaches it when away)`;
  return [
    where,
    `Pair a phone: scan this code, or open ${phone.pairingUrl} (pairing code ${phone.code}, 10 minutes, works once; the phone then opens every project on this computer)`,
    ...(phone.byAddress
      ? [`If the phone cannot open the .local name, open ${phone.byAddress}`]
      : []),
    renderUnicodeCompact(phone.pairingUrl, { ecc: 'M', border: 2 }),
    'A new code and the paired devices are in the UI, in Settings > Phone; otea devices list and revoke them too',
  ].join('\n');
}

// Why a server stops once the process that started it ended (P1-R3-5): it stopped saying nothing,
// and a server started in the background seemed to die at random.
function ownerGoneText(started: number): string {
  return `serve stopped: the process that started it (${started}) ended, as when the terminal or the agent session that ran it closes. To keep it running on its own, start it with otea serve start, and stop it with otea serve stop.`;
}

// The sign-in link for a person to open by hand, which a transcript or a log may keep: the page's
// own link with a single-use token in place of the long-lived key (P3-F5). It works once, for ten
// minutes; the server it signs in to redeems it from the Otea home.
// A server started by an older Otea (its serve.json says nothing of single-use links) cannot redeem
// one: no link is printed, never one that would be refused, and the person is told how to get one.
function singleUseSignIn(signInUrl: string): { url: string } | { note: string } {
  const home = oteaHome();
  const running = readServeFile(home);
  if (running && !running.links) {
    return {
      note: `No sign-in link is printed: the Otea server running here (pid ${running.pid}) is from an older Otea and cannot take single-use links. Run otea serve stop, then start it again; otea open signs a browser in meanwhile`,
    };
  }
  const link = issueSignInLink(home);
  const url = new URL(signInUrl);
  url.searchParams.set('token', link);
  return { url: url.toString() };
}

const SINGLE_USE_NOTE = `works once, within ${SIGNIN_LINK_LIFETIME_MS / 60_000} minutes; run the command again for another`;

// What to do after a server answers: sign a browser in on the project's page, or print the link
// for the person (or the agent that relays it) when --no-open. The printed link is single-use, never
// the server's key; it is never in --json.
async function signInLines(
  { flag, openUrl, warn }: Pick<Input, 'flag' | 'openUrl' | 'warn'>,
  signInUrl: string,
): Promise<string[]> {
  if (flag('no-open')) {
    const link = singleUseSignIn(signInUrl);
    return ['note' in link ? link.note : `Sign a browser in at ${link.url} (${SINGLE_USE_NOTE})`];
  }
  await openUrl(signInUrl).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`Could not open a browser (${reason}); run "otea open" to try again`);
  });
  return [];
}

// How the background server runs Otea again: the node that runs this command (a bare `node` of a
// launcher may be no command at all on the PATH of a service), or the desktop app's Electron.
function daemonLaunch(): Launch {
  const command = OTEA.command === 'node' ? process.execPath : OTEA.command;
  return { command, args: OTEA.args, ...(OTEA.env ? { env: OTEA.env } : {}) };
}

// This computer's background server, started when none runs. Its port is --port, else the port it
// last ran on (P6-F4: a restart kept at 4400 broke the bookmarks and the sign-in of the port before),
// else 4400. `notes` say what a person would otherwise not know: that the port came from the last
// run, or that --port was ignored because a server already runs on another.
async function ensureDesk(
  { option, warn }: Pick<Input, 'option' | 'warn'>,
  home: string,
): Promise<{
  state: Extract<ServerState, { kind: 'running' }>;
  started: boolean;
  notes: string[];
  ignoredPort?: number;
}> {
  const { port, remembered } = portToStart(option('port'), home);
  let desk: Awaited<ReturnType<typeof ensureServer>>;
  try {
    desk = await ensureServer(home, { port, launch: daemonLaunch(), warn });
  } catch (error) {
    if (remembered && error instanceof Error) {
      error.message += `\nIt tried port ${port}, where this computer's server last ran; --port picks another`;
    }
    throw error;
  }
  const { state, started } = desk;
  if (!started && option('port') !== undefined && port !== 0 && port !== state.port) {
    return {
      state,
      started,
      ignoredPort: port,
      notes: [
        `--port ${port} was ignored: the server already runs on port ${state.port}. To move it, run otea serve stop, then otea serve start --port ${port}`,
      ],
    };
  }
  const notes =
    started && remembered ? [`It uses port ${port}, where it last ran (--port picks another)`] : [];
  // A server an upgrade left running is not the installed Otea: say so, never restart it unasked.
  const outdated = started ? undefined : serverVersionNote(readServeFile(home), OTEA_VERSION);
  return { state, started, notes: outdated ? [...notes, outdated] : notes };
}

const serveStart: Command = {
  name: 'serve start',
  summary: `Start this computer's otea serve in the background, on its own: it keeps running after the terminal or the agent's session that started it ends, until otea serve stop. Answers once it serves (on --port, else the port it last ran on, else ${DEFAULT_PORT}), then opens this project's page signed in (--no-open prints a single-use sign-in link instead, never the key). One server runs per Otea home: when it runs already, this only opens this project there, and a --port that differs says it was ignored (otea serve stop first moves it). It never opens Otea to the local network at start, and --lan is refused: a phone needs the foreground otea serve --lan or the desktop app. Its output (no sign-in link) is in serve.log in the Otea home`,
  args: [],
  options: { port: {}, 'no-open': { flag: true }, lan: { flag: true } },
  execute: async (input) => {
    const { cwd, flag } = input;
    if (flag('lan')) {
      throw new UsageError(
        'otea serve start never opens Otea to the local network, so no listener runs there unattended: for a phone, run otea serve --lan in a terminal of your own, or open the Otea desktop app',
      );
    }
    const here = projectHere(cwd);
    const home = oteaHome();
    const { state, started, notes, ignoredPort } = await ensureDesk(input, home);
    const { url, signInUrl } = pages(state.url, state.token, here);
    const signIn = await signInLines(input, signInUrl);
    const { pid, port } = state;
    const where = started
      ? `Otea running in the background at ${url} (pid ${pid}; stop it with otea serve stop; log: ${join(home, SERVE_LOG)})`
      : `Otea already runs on this computer (pid ${pid}): this project is at ${url}`;
    return {
      data: {
        url,
        pid,
        port,
        ...(started ? {} : { attached: true }),
        ...(ignoredPort === undefined ? {} : { ignoredPort }),
      },
      text: [where, ...notes, ...signIn].join('\n'),
    };
  },
};

const serveStop: Command = {
  name: 'serve stop',
  summary:
    "Stop this computer's otea serve, however it was started, by its process id. Stops nothing when none runs (the record of one that ended is cleaned up). The Otea desktop app's own server is refused unless --force: it would close under the app's window",
  args: [],
  options: { force: { flag: true } },
  execute: async ({ flag }) => {
    const home = oteaHome();
    if (!flag('force')) {
      const held = await inspectServer(home);
      const info = readServeFile(home);
      if ((held.kind === 'running' || held.kind === 'unresponsive') && info?.owner === 'desktop') {
        throw new OteaError(
          'forbidden',
          `The server running here (pid ${info.pid}) belongs to the Otea desktop app: stopping it would close it under the app's window. Quit the app instead, or end it anyway with otea serve stop --force`,
        );
      }
    }
    const result = await stopServer(home, OTEA.args.at(-1) ?? '');
    if (!result) return { data: { stopped: false }, text: 'No otea serve is running' };
    if ('stale' in result) {
      return {
        data: { stopped: false, stale: result.stale.pid },
        text: `No otea serve is running: removed the record of ${result.stale.pid}, which is no server of this Otea home`,
      };
    }
    const { pid, port } = result.stopped;
    return {
      data: { stopped: true, pid, port },
      text: `Stopped otea serve (pid ${pid}, port ${port})`,
    };
  },
};

const serveStatus: Command = {
  name: 'serve status',
  summary:
    "Say whether this computer's otea serve runs, with its address and process id; exits 11 (not_running) when none does, and cleans up the record of one that ended. A server whose process lives but did not answer in time exits 13 (timeout) and keeps its record",
  args: [],
  options: {},
  execute: async () => {
    const home = oteaHome();
    const state = await inspectServer(home);
    forgetStale(home, state);
    if (state.kind === 'unresponsive') {
      throw new CommandFailure(
        'timeout',
        `${unresponsiveText(state)}; its record is kept. Try again, or end it with otea serve stop`,
      );
    }
    if (state.kind !== 'running') {
      throw new CommandFailure('not_running', 'otea serve is not running; run "otea serve start"');
    }
    const { url, pid, port } = state;
    const info = readServeFile(home);
    const note = serverVersionNote(info, OTEA_VERSION);
    return {
      data: {
        running: true,
        url,
        pid,
        port,
        ...(info?.version ? { version: info.version } : {}),
        ...(note ? { restart: true } : {}),
      },
      text: [
        `otea serve is running at ${url} (pid ${pid}, port ${port}${info?.version ? `, Otea ${info.version}` : ''})`,
        ...(note ? [note] : []),
      ].join('\n'),
    };
  },
};

// otea start: the person's first minutes in one command (README, Getting started).
const start: Command = {
  name: 'start',
  summary: `For you, not for an agent, in the project's folder: set everything up for a first session in one command, and say what is ready. It creates the project when there is none (otea init), starts this computer's background server and opens the desk signed in (otea serve start; --no-open prints a single-use sign-in link instead, --port picks the port for a first start, and a later start keeps the port it last ran on), offers a first board from a template when the project has none of its own (--template <key> names one, none skips it; at a terminal, when not given, a short numbered choice asks (code changes, to-dos, or let your agent design them; Enter takes the default it shows, none or Ctrl+C makes no board); --yes takes the default that choice shows (changes in a git repo, to-dos in a plain folder) without asking; --no-board asks nothing and makes none; with --json or no terminal nothing is asked and no board is made, the report naming the command for each template instead); the board and the text are in ${LANGUAGE_RULE} or the one --lang gives (a project it makes is made in it), once, which is how to force one, and the report says which; it prints the text to paste into your agent's chat (otea prompt) with the MCP server it adds to its own config. It looks before it acts: run again, it changes nothing that exists and says what was already there. An agent never runs it: it connects with otea connect and never starts the desk`,
  details: TEMPLATE_LIST,
  args: [],
  options: {
    template: { placeholder: 'key' },
    lang: { choices: LANGS },
    port: {},
    'no-open': { flag: true },
    yes: { flag: true },
    'no-board': { flag: true },
  },
  execute: async (input) => {
    const { cwd, option, agent } = input;
    if (agent !== undefined) {
      throw new OteaError(
        'forbidden',
        `otea start is for the person: it starts the desk, which closes with an agent's session. An agent connects with otea connect --as ${agent} --model <model> --effort <effort>`,
      );
    }
    const yes = input.flag('yes');
    const noBoard = input.flag('no-board');
    if (noBoard && (yes || option('template') !== undefined)) {
      throw new UsageError(
        '--no-board asks nothing and makes no board: it takes no --yes or --template',
      );
    }
    const template = noBoard ? NO_BOARDS : option('template');
    // --yes is yes to the default the question shows. --json or a pipe is never asked: with no one
    // to choose, no board is made.
    const fallback = defaultBoard(checkoutRoot(cwd) !== undefined);
    const report = await startProject(cwd, {
      template,
      lang: option('lang') as Lang | undefined,
      ...(yes
        ? { choose: async () => fallback.key }
        : input.flag('json')
          ? {}
          : {
              choose: async () => {
                const answer = await input.ask(choiceQuestion(fallback)).catch((error: unknown) => {
                  throw cancelled(error) ?? error;
                });
                // Nobody to ask (no terminal): no board, as before.
                return answer === undefined ? undefined : choiceFrom(answer, fallback);
              },
            }),
    });
    // The background server serves this project: a local one is remembered for it first.
    const here = projectHere(cwd);
    const home = oteaHome();
    const { state, started, notes } = await ensureDesk(input, home);
    const { url, signInUrl } = pages(state.url, state.token, here);
    // Opening a browser prints nothing. With --no-open the link is yours alone, in a block of its
    // own above the text for the agent, so the two are never copied together: it holds this
    // computer's Otea key.
    const noOpen = input.flag('no-open');
    if (!noOpen) await signInLines(input, signInUrl);
    const link = noOpen ? singleUseSignIn(signInUrl) : undefined;
    const signIn = !link
      ? []
      : 'note' in link
        ? ['', link.note]
        : [
            '',
            `Sign-in link, for you only (${SINGLE_USE_NOTE}; never paste it to your agent):`,
            `  ${link.url}`,
          ];
    const { entry } = mcpEntryFor(input, report.project.id);
    const mcp = { name: MCP_SERVER, ...entry };
    const { project, created, boards, prompt, lang } = report;
    const { pid, port } = state;
    const kept =
      template !== undefined &&
      template !== NO_BOARDS &&
      boards.made.length === 0 &&
      boards.all.length > 0;
    const projectLine = created
      ? `Project: set up "${project.name}" (data in ${project.dataDir})`
      : `Project: "${project.name}" is already set up (data in ${project.dataDir})`;
    const boardsLine =
      boards.made.length > 0
        ? `Boards: made ${boards.made.map(({ name }) => `"${name}"`).join(', ')}`
        : boards.all.length > 0
          ? `Boards: already has ${boards.all.map((name) => `"${name}"`).join(', ')}${kept ? `; --template ${template} was not added to them (otea board add <name> --template ${template} adds it)` : ''}`
          : // No board was made: no one chose (no terminal, a script) or the person chose none. They
            // leave with the way to one: the exact command for each template and what it is for,
            // or the agent designs them with them.
            boardHintLines().join('\n');
    const deskLine = started
      ? `Desk: running in the background at ${url} (pid ${pid}; stop it with otea serve stop)`
      : `Desk: already running at ${url} (pid ${pid})`;
    // Which language the boards and the text for the agent are in, and how to force the other.
    const [said, other, otherKey] =
      lang === 'es' ? ['Spanish', 'English', 'en'] : ['English', 'Spanish', 'es'];
    const langLine = `Language: ${said} for the boards and the text below (--lang ${otherKey} makes them ${other})`;
    const text = [
      projectLine,
      boardsLine,
      langLine,
      deskLine,
      ...notes,
      ...signIn,
      '',
      "Next, paste this into your agent's chat (otea prompt prints it again):",
      ...prompt.split('\n').map((line) => `  ${line}`),
      '',
      `Your agent adds Otea's MCP server to its own config when it connects (the text above tells it; otea connect prints the details): ${JSON.stringify({ [MCP_SERVER]: entry })}`,
    ];
    return {
      data: {
        project: { ...project, created },
        boards,
        lang,
        desk: { url, pid, port, started },
        prompt,
        mcp,
      },
      text: text.join('\n'),
    };
  },
};

const serve: Command = {
  name: 'serve',
  summary: `Serve the live UI of every project on this computer on 127.0.0.1 (default port ${DEFAULT_PORT}) until Ctrl+C, and open this project's page signed in; when this computer's otea serve runs already, it opens this project there instead. It also opens to phones on the same network when that was left open (Settings > Phone, otea phone lan --open), and --lan opens it for this run only; a phone on Tailscale (otea phone tailscale) pairs without it. It stops once the process that started it ends (a terminal closed, an agent's session over), saying so on stderr; otea serve start keeps it running on its own instead (--no-owner is what it runs with), and otea serve stop and otea serve status manage it`,
  args: [],
  options: {
    port: {},
    'no-open': { flag: true },
    'no-owner': { flag: true },
    lan: { flag: true },
    // What otea serve start runs it with: no sign-in link or pairing code in its output (it goes
    // to a log), and the local network stays closed unless a person opens it.
    daemon: { flag: true },
    // What the desktop app runs it with, to say whose server it is (--served-by desktop).
    'served-by': { choices: ['desktop'] },
  },
  execute: async (input) => {
    const { cwd, option, flag, signal, warn, tailscale, probe, home } = input;
    if (flag('daemon') && option('served-by') !== undefined) {
      throw new UsageError('--daemon and --served-by cannot be used together');
    }
    // A server whose starter is gone (an agent's session that ran it in the background ended)
    // stops, as it would with the terminal that ran it, and says why; --no-owner keeps it.
    const owner = flag('no-owner') ? undefined : watchOwner(signal);
    owner?.signal.addEventListener(
      'abort',
      () => {
        if (owner.orphaned()) warn(ownerGoneText(owner.started));
      },
      { once: true },
    );
    const served = await serveUntil(owner?.signal ?? signal, cwd, {
      port: portFrom(option('port')),
      lan: flag('lan'),
      unattended: flag('daemon'),
      desktop: option('served-by') === 'desktop',
      tailscale,
      probe,
      warn,
      gitHook: withHome(OTEA, home),
    }).catch((error: unknown) => {
      owner?.stop();
      throw error;
    });
    // Pointing at the server that runs: nothing of this process stays running.
    if (served.attached) owner?.stop();
    const { url, signInUrl, phone, attached } = served;
    // With --no-open the person signs a browser in by hand, from a terminal or from what an agent
    // that started the server relays. A background server prints no link: its output is a file.
    const signIn = flag('daemon') ? [] : await signInLines(input, signInUrl);
    const where = attached
      ? `Otea already runs on this computer: this project is at ${url}`
      : `Otea running at ${url}`;
    const running = [where, ...signIn].join('\n');
    const data = { url, ...(attached ? { attached } : {}) };
    if (!phone) return { data, text: running };
    return { data: { ...data, phone }, text: `${running}\n${phoneText(phone)}` };
  },
};

const devicesList: Command = {
  name: 'devices list',
  summary:
    'List the paired phones and tablets (local network or otea phone tailscale), with when each was last seen; each one opens every project on this computer',
  args: [],
  options: {},
  execute: () => {
    const devices = withMachine(process.env, listDevices);
    const text = devices
      .map(
        ({ id, name, pairedAt, lastSeenAt, hint }) =>
          `${id}  ${name}  paired ${timeText(pairedAt)}  last seen ${lastSeenAt ? timeText(lastSeenAt) : 'never'}  token ··${hint}`,
      )
      .join('\n');
    return { data: devices, text: text || 'No paired devices' };
  },
};

const devicesRevoke: Command = {
  name: 'devices revoke',
  summary: 'Revoke a paired device: its token stops working at once, even while otea serve runs',
  args: ['id'],
  options: {},
  execute: ({ args: [id = ''] }) => {
    const device = withMachine(process.env, (machine) => revokeDevice(machine, id));
    return { data: device, text: `Revoked ${device.id} (${device.name})` };
  },
};

function notRunning(message: string): CommandFailure {
  return new CommandFailure('not_running', `${message}; run "otea serve start" first`);
}

const open: Command = {
  name: 'open',
  summary:
    "Open this project's page on this computer's running otea serve in the browser, signed in to act on items. --no-open opens nothing and prints a fresh single-use sign-in link instead (works once, within 10 minutes), for a browser you open by hand: a headless or remote session, or the page that says your session ran out",
  args: [],
  options: { port: {}, 'no-open': { flag: true } },
  execute: async ({ cwd, option, flag, openUrl, warn }) => {
    const here = projectHere(cwd);
    const home = oteaHome();
    const port = portToOpen(option('port'));
    const token = readUiToken(home);
    if (!token) throw notRunning('No Otea server has been started on this computer');
    const { url, signInUrl: link } = pages(`http://127.0.0.1:${port}`, token, here);
    const probe = await probeSignIn(link);
    if (probe === 'down') throw notRunning(`No Otea server answers on port ${port}`);
    if (probe === 'other')
      throw notRunning(`The Otea server on port ${port} is another Otea home's (OTEA_HOME)`);
    // The link is the person's to open by hand, single-use and never the key, as serve --no-open's.
    if (flag('no-open')) {
      // A server an older Otea started cannot redeem one: nothing to print, so it is no success.
      const running = readServeFile(home);
      if (running && !running.links) {
        throw new CommandFailure(
          'not_running',
          `No sign-in link: the Otea server running here (pid ${running.pid}) is from an older Otea and cannot take single-use links. Run otea serve stop, then otea serve start, and run otea open --no-open again`,
        );
      }
      const lines = await signInLines({ flag, openUrl, warn }, link);
      const outdated = serverVersionNote(running, OTEA_VERSION);
      return { data: { url }, text: [...lines, ...(outdated ? [outdated] : [])].join('\n') };
    }
    await openUrl(link).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not open a browser (${reason})`);
    });
    const outdated = serverVersionNote(readServeFile(home), OTEA_VERSION);
    return {
      data: { url },
      text: [`Opened Otea at ${url}`, ...(outdated ? [outdated] : [])].join('\n'),
    };
  },
};

// Stdout carries the protocol, so the command prints nothing itself.
// The agent counts as heard as soon as its MCP client connects, and again on every beat while the
// server stays open. Without a project yet there is nowhere to note it, and every tool call will
// say so, so that is no warning.
// Each server is its own session (process.pid): a name another open session works under is not
// taken (claimName), and the refusal reaches the agent on its call.
function heardBy(
  cwd: string,
  agent: string,
  harness: Harness | undefined,
  warn: Input['warn'],
  newSession = false,
  // Its first call under the name: a new server its harness started may take it from the old one.
  fresh = newSession,
  // When it was heard, for the server to end its listening when its client closes.
  heard?: (at: string) => void,
) {
  try {
    withProject(cwd, (project) => {
      // An agent at work in another project is no one's to hear here (its calls are refused).
      holdAgentHome(project, agent);
      claimName(
        project.db,
        agent,
        process.pid,
        undefined,
        undefined,
        process.ppid,
        fresh,
        harness?.name,
      );
      const at = hearAgent(project.db, {
        agent,
        channel: 'mcp',
        harness,
        session: process.pid,
        launcher: process.ppid,
        ...(newSession ? { newSession } : {}),
      });
      heard?.(at);
    });
    return true;
  } catch (error) {
    if (error instanceof OteaError && error.code === 'not_found') return true;
    if (error instanceof OteaError && error.code === 'name_in_use') return false;
    if (error instanceof OteaError && error.code === 'forbidden') return false;
    warn(`could not note ${agent} as seen: ${(error as Error).message}`);
    return true;
  }
}

// The first call of an agent on this server: refused while another open session works under its
// name, so two sessions never share one.
function claimedBy(cwd: string, agent: string, fresh: boolean, client?: Harness): void {
  try {
    withProject(cwd, (project) =>
      claimName(
        project.db,
        agent,
        process.pid,
        undefined,
        undefined,
        process.ppid,
        fresh,
        client?.name,
      ),
    );
  } catch (error) {
    if (error instanceof OteaError && error.code === 'name_in_use') throw error;
  }
}

const mcp: Command = {
  name: 'mcp',
  summary:
    'Serve the agent commands as MCP tools on stdin and stdout until the client disconnects; each tool call acts as the agent its as argument names (or the one --as names). --project <id> pins the server to that project: it refuses writes from a folder of another one, and serves it when started outside any project. A tool answers with the text the command prints; --json makes it answer with the data otea --json prints, for a program that reads it',
  args: [],
  options: { project: { placeholder: 'id' } },
  execute: async ({ cwd, agent, pin: pinned, option, flag, signal, warn }) => {
    if (agent !== undefined) assertAgentName(agent);
    const pin = option('project') ?? pinned;
    // A harness that starts the server outside any project (its own config, kept for every folder)
    // gets the project the server is pinned to.
    if (pin !== undefined && !process.env.OTEA_PROJECT && !projectAt(cwd)) {
      process.env.OTEA_PROJECT = pin;
    }
    // Every agent that connected or called through this server, heard again on each beat until
    // the client disconnects: that is what makes it count as connected.
    const voices = new Set<string>();
    // When this server last heard each of them: closing, it ends their listening (endListening).
    const lastHeard = new Map<string, string>();
    const note = (name: string) => (at: string) => lastHeard.set(name, at);
    // Every name this server ever worked under: one it lost to a newer server never counts as new.
    const used = new Set<string>();
    let client: Harness | undefined;
    // The client names its harness as it connects. Its agent is heard from its first call: a
    // harness that only loads the server (a background service, a session that never calls Otea)
    // is no agent at work, and shows as none.
    // The load is noted for its harness, though (P4-R2-10): otea connect --check and the desk can
    // tell the server works there before any tool is called.
    const greeted = (harness: Harness | undefined) => {
      client = harness;
      if (!harness) return;
      try {
        withProject(cwd, (project) => mcpLoaded(project.db, harness, systemClock, process.pid));
      } catch {
        // No project yet: every tool call will say so.
      }
    };
    // The names this server heard that were unknown before it did: one whose first call fails is
    // forgotten again, so a failed call leaves no agent «sin perfil» on the desk (P2S-R2-3).
    const newcomers = new Set<string>();
    // When each agent last called through this server: a subagent that stopped calling has ended,
    // and the beat stops hearing it (P1-11); the session's own agent is the one it was started as,
    // else the first that called. A rename is told by the agent (whoami or profile under another
    // name, `rebounded`), never guessed from names: see quietVoices.
    const calls = new Map<string, number>();
    const rebounded = new Set<string>();
    let own = agent;
    const rebound = (name: string) => {
      if (name !== own) rebounded.add(name);
    };
    const heard = (name: string) => {
      const fresh = !used.has(name);
      used.add(name);
      claimedBy(cwd, name, fresh, client);
      if (!knownAgent(cwd, name)) newcomers.add(name);
      heardBy(cwd, name, client, warn, false, fresh, note(name));
      voices.add(name);
      calls.set(name, Date.now());
      own ??= name;
    };
    const still = (name: string) => {
      claimedBy(cwd, name, false, client);
      calls.set(name, Date.now());
      voices.add(name);
    };
    const failed = (name: string) => {
      if (!newcomers.delete(name)) return;
      voices.delete(name);
      lastHeard.delete(name);
      try {
        withProject(cwd, (project) => forgetAgent(project.db, name));
      } catch {
        // No project to forget it in.
      }
    };
    // The server says it runs as it starts and on every beat, whether or not an agent calls through
    // it, so the desk and whoami never take a process that got its id after it ended for it
    // (P3C-R3-12); closing, it says it ended.
    const runs = (state: 'start' | 'beat' | 'end' = 'beat') => {
      try {
        withProject(cwd, (project) => {
          if (state === 'start') startProcess(project.db, process.pid);
          else if (state === 'end') endProcess(project.db, process.pid);
          else beatProcess(project.db, process.pid);
        });
      } catch {
        // No project yet: nobody watches this server.
      }
    };
    runs('start');
    // Each tool call it serves is noted, a wait as open until it ends: a newer server of the same
    // harness takes its agent's name only once this one went quiet (claimName, P8-R3-1).
    const calling = (command: string) => {
      const long = command === 'wait';
      const note = (open: number) => {
        try {
          withProject(cwd, (project) => noteCall(project.db, process.pid, systemClock, open));
        } catch {
          // No project yet: nobody takes a name here.
        }
      };
      note(long ? 1 : 0);
      return () => {
        if (long) note(-1);
      };
    };
    const beat = setInterval(() => {
      runs();
      const quiet = quietVoices(calls, own, Date.now(), rebounded).filter((name) =>
        voices.has(name),
      );
      for (const name of quiet) voices.delete(name);
      endListeningAll(
        cwd,
        new Map(
          quiet.flatMap((name) => (lastHeard.has(name) ? [[name, lastHeard.get(name) ?? '']] : [])),
        ),
      );
      for (const name of voices)
        if (!heardBy(cwd, name, client, warn, false, false, note(name))) voices.delete(name);
    }, LISTEN_BEAT_MS);
    beat.unref();
    const named = agent === undefined ? {} : { agent };
    try {
      // Whether the project keeps side topics, read once: the guide the agent gets says so.
      const topics = (() => {
        try {
          return withProject(cwd, (project) => topicsGuided(project));
        } catch {
          return false;
        }
      })();
      // The MCP server's modules load only here, so every other command starts without them.
      const { createMcpServer, serveStdio } = await import('../mcp/server.ts');
      await serveStdio(
        createMcpServer(COMMANDS, {
          cwd,
          ...named,
          ...(pin === undefined ? {} : { pin }),
          // otea mcp --json: results as the data --json prints, for a program; else the text.
          ...(flag('json') ? { json: true } : {}),
          topics,
          warn,
          greeted,
          heard,
          still,
          rebound,
          failed,
          calling,
        }),
        signal,
      );
    } finally {
      clearInterval(beat);
      // The client closed the session: its agents no longer listen through this server.
      endListeningAll(cwd, lastHeard);
      runs('end');
    }
    return undefined;
  },
};

// Whether the project knows the agent already (no project: as good as known, nothing to forget).
function knownAgent(cwd: string, name: string): boolean {
  try {
    return withProject(cwd, (project) => findAgent(project.db, name) !== undefined);
  } catch {
    return true;
  }
}

// Whether a project resolves from the folder (or OTEA_PROJECT names one).
function projectAt(cwd: string): boolean {
  try {
    withProject(cwd, () => undefined);
    return true;
  } catch (error) {
    if (error instanceof OteaError && error.code === 'not_found') return false;
    throw error;
  }
}

function endListeningAll(cwd: string, lastHeard: ReadonlyMap<string, string>): void {
  if (lastHeard.size === 0) return;
  try {
    withProject(cwd, (project) => {
      for (const [name, at] of lastHeard) endListening(project.db, name, at, process.pid);
    });
  } catch {
    // The project may be gone; its agents' listening then lapses on its own.
  }
}

// The fields a gate check matches: --field pairs, plus the branch and the repo, which default to
// the git checkout's when given without a value (the branch to `defaultBranch`, when given; the
// repo to the name the project gives the repo checked out, app/repos.ts).
function gateFields(
  { option, options }: Input,
  cwd: string,
  project: Project,
  defaultBranch = () => currentBranch(cwd),
): Record<string, string> {
  const fields: Record<string, string> = {};
  const set = (key: string, value: string) => {
    if (key in fields) throw new UsageError(`Field "${key}" given twice`);
    fields[key] = value;
  };
  for (const pair of options('field')) set(...fieldPair(pair));
  const branch = option('branch');
  if (branch !== undefined) set('branch', branch || defaultBranch());
  const repo = option('repo');
  if (repo !== undefined) set('repo', repo || repoNameAt(project, cwd));
  return fields;
}

function gateText({ gate, allowed, items, refusal, person }: GateCheck): string {
  // On a board, the step engine's words for each item, and why a push into a protected base
  // branch that brings in none of its items is refused; last, how the person lands their own.
  const said = items.filter((item) => allowed || !item.allowed).flatMap(({ text }) => text ?? []);
  if (refusal !== undefined) said.push(refusal);
  if (person !== undefined) said.push(person);
  if (said.length > 0) return said.join('\n');
  if (allowed) {
    const states = items.map(({ id, stateName }) => `${id} is ${stateName}`);
    return `${gate} allowed: ${states.join(', ')}`;
  }
  return items
    .filter((item) => !item.allowed)
    .map(
      ({ id, stateName, allowedInNames }) =>
        `${gate} refused: ${id} is ${stateName}; ${gate} is allowed only in ${allowedInNames.join(', ')}`,
    )
    .join('\n');
}

// The commits a push sends, as `--commits <remote>..<local>` names them: what the remote has of
// the branch and what it gets (the ids a pre-push hook reads; all zeros for a branch created or
// deleted).
function commitsOption(value: string): { from: string; to: string } {
  const [from, to, ...rest] = value.split('..');
  if (from === undefined || to === undefined || rest.length > 0) {
    throw new UsageError('--commits takes <remote>..<local>, the commits the push sends');
  }
  return { from, to };
}

// A gate check fails open: anything that keeps it from answering allows the action, with a note.
// A push or merge in a repo the project cannot match (--repo with no name) is refused, not
// allowed, whatever its folder: on a project, failing open there would skip every gate.
const check: Command = {
  name: 'check',
  summary:
    'Check whether the items matching the fields allow a gated action: exit 0 when allowed, 19 when refused, 2 for a gate nothing declares; repo names match whatever their case; it allows the action, with a note, when no item matches or the check cannot run, except a push of a branch no item names in a project where a board protects a base branch, which it refuses. --branch defaults to the branch checked out, --repo to the name the project gives the repo checked out (otea repos list), refused when the project does not know it. A push or merge into a base branch a board protects is checked against the items whose branches it brings in: --commits <remote>..<local> names the commits a push sends (the pre-push hook passes them), else the branch against the remote branch of the same name (origin/<branch>), or its upstream when the remote has none. A merge of a branch the person approved fetches it from its remote and is refused when it is not the approved commit (or a rebase of it with the same result), or when the check cannot fetch it',
  args: [],
  options: {
    gate: { required: true, placeholder: 'action' },
    field: { multiple: true, placeholder: 'key=value' },
    branch: { optionalValue: true, placeholder: 'name' },
    repo: { optionalValue: true, placeholder: 'name' },
    commits: { placeholder: 'remote..local' },
  },
  execute: async (input) => {
    const gate = input.required('gate');
    // The hook runs this check on every push: an outdated one that is exactly Otea's is brought up
    // to date here, once (P10-F2); one with edits or lines of the person's is said on every push.
    const refreshed = refreshedHookLine(input);
    if (refreshed !== undefined) input.warn(refreshed);
    const outdated = outdatedGitHookLine(input.cwd);
    if (outdated !== undefined) input.warn(outdated);
    let result: GateCheck;
    try {
      const { cwd } = input;
      const named = input.option('branch');
      const commits = input.option('commits');
      const sent = commits === undefined ? undefined : commitsOption(commits);
      // A commit the repo does not have leaves the check blind to what it brings in (P3C-R3-3):
      // refused, never allowed with a note. All zeros is a deleted branch, which brings in nothing.
      if (sent && !/^0+$/.test(sent.to) && !hasCommit(cwd, sent.to)) {
        const text = `${gate} refused: could not check: ${sent.to} is not in this repository; fetch first.`;
        const data: GateCheck = { gate, allowed: false, items: [], refusal: text };
        return { data, text, failure: 'gate_refused' };
      }
      result = withProject(cwd, (project) => {
        // The branch is asked of git only when the check needs it.
        const branch = () => named || currentBranch(cwd);
        // A merge of an approved branch is checked against the remote as it is now (P3C-R3-1).
        const takes = (tip: Tip, base?: string) => mergeTake(cwd, tip, base, sent?.to);
        const brings: Brings = () => ({
          ...(sent === undefined
            ? branchesBrought(cwd, branch(), remoteOf(cwd, branch()))
            : branchesBrought(cwd, sent.to, sent.from)),
          takes,
          // A push the hook names rewrites the remote branch unless it adds to it (P1-R3-3).
          ...(sent === undefined
            ? {}
            : { rewrites: () => rewritesRemote(cwd, sent.from, sent.to) }),
        });
        return checkGate(project, gate, gateFields(input, cwd, project, branch), brings);
      });
    } catch (error) {
      if (error instanceof UsageError) throw error;
      // Inside a project, a repo it cannot match could be any of its repos: refused, not allowed.
      if (error instanceof UnknownRepo) {
        input.warn(`${gate} refused: ${error.message}`);
        return { data: { gate, allowed: false, items: [] }, text: '', failure: 'gate_refused' };
      }
      // A field or a gate nothing names is a typo in the call, never a reason to allow the action.
      if (error instanceof OteaError && error.code === 'invalid_fields')
        throw new UsageError(error.message);
      if (error instanceof OteaError && error.code === 'invalid_gate') throw error;
      const message = error instanceof Error ? error.message : String(error);
      result = { gate, allowed: true, items: [], note: `could not check (${message})` };
    }
    if (result.note) input.warn(`${result.note}; ${gate} allowed`);
    if (result.items.length === 0 && result.refusal === undefined)
      return { data: result, text: '' };
    const text = gateText(result);
    if (result.allowed) return { data: result, text };
    return { data: result, text, failure: 'gate_refused' };
  },
};

// The hooks a command names, of those it takes; never none. No gate depends on a harness hook:
// install writes only the git hook, and remove --claude takes out the Claude Code hooks an older
// otea hook install --claude wrote, whose commands are gone.
function hookTargets<T extends string>({ flag }: Input, targets: readonly T[]): T[] {
  const named = targets.filter((target) => flag(target));
  if (named.length === 0) {
    throw new UsageError(`Name the hook: ${targets.map((target) => `--${target}`).join(' or ')}`);
  }
  return named;
}

function hookText({ path, action, content, note, said }: HookChange): string {
  const why = note === undefined ? '' : ` (${note})`;
  if (said === undefined && action === 'unchanged')
    return `${path} already has the Otea hook${why}`;
  if (said === undefined && action === 'absent') return `${path} has no Otea hook`;
  const done = { created: 'Wrote', updated: 'Rewrote', removed: 'Removed the Otea hook from' };
  const head = said ?? `${done[action as keyof typeof done]} ${path}${why}`;
  return content === undefined ? head : `${head}:\n${indent(content.trimEnd())}`;
}

function hookOutput(changes: HookChange[]): Output {
  return { data: changes, text: changes.map(hookText).join('\n') };
}

const hookInstall: Command = {
  name: 'hook install',
  summary:
    'Make the gates hard in the repo here, whatever tool runs the push or merge: --git writes a pre-push hook that runs otea check --gate push (never overwrites a hook of someone else); --forge has gh set a GitHub ruleset on the base branches the boards protect, so GitHub refuses a direct push, a force push and a deletion of them, or prints the steps to set it by hand',
  args: [],
  options: { git: { flag: true }, forge: { flag: true } },
  // Each hook is installed on its own: one that cannot be (no repo, a team's own pre-push hook)
  // never keeps another from being written, and the refusal says what was written.
  execute: (input) => {
    const changes: HookChange[] = [];
    const refused: Error[] = [];
    for (const target of hookTargets(input, ['git', 'forge'])) {
      try {
        changes.push(
          target === 'git'
            ? installGitHook(input.cwd, withHome(OTEA, input.home))
            : installForge(input.cwd, withProject(input.cwd, protectedBases), input.forge),
        );
      } catch (error) {
        if (!(error instanceof CommandFailure || error instanceof OteaError)) throw error;
        refused.push(error);
      }
    }
    const [first] = refused;
    if (!first) return hookOutput(changes);
    const said = [...changes.map(hookText), ...refused.map(({ message }) => message)];
    throw new CommandFailure(failureCode(first), said.join('\n'));
  },
};

const hookRemove: Command = {
  name: 'hook remove',
  summary:
    'Remove the hooks Otea wrote, leaving every other hook and rule: --git the pre-push hook; --forge the GitHub ruleset hook install --forge set; --claude the Claude Code hooks and allow rules an older otea hook install --claude added to .claude/settings.local.json',
  args: [],
  options: { git: { flag: true }, forge: { flag: true }, claude: { flag: true } },
  execute: (input) =>
    hookOutput(
      hookTargets(input, ['git', 'forge', 'claude']).map((target) =>
        target === 'git'
          ? removeGitHook(input.cwd)
          : target === 'forge'
            ? removeForge(input.cwd, input.forge)
            : removeClaudeHook(input.cwd),
      ),
    ),
};

const UNINSTALL_LEFT =
  "Otea wrote no config in your agent's harness: if you added the otea MCP server there, remove it from that config yourself.";

const uninstall: Command = {
  name: 'uninstall',
  summary:
    "Take Otea's footprint off this computer, leave every repo it was set up in as it was before otea init, and tell what it removed. Repos (--only repos): in the repo here and in every repo and folder the registry links to a project (otea projects list), skipping, and saying so, one that is gone: the pre-push hook (only one marked as Otea's), the Claude Code hooks and allow rules an older Otea wrote, and Otea's block in AGENTS.md (the file goes when nothing else is in it). Machine (--only machine): this Otea home's background server (otea serve stop). Without --only, both. Your Otea data (the Otea home, and .otea in the repo) is never deleted unless --purge-data says so, and then it asks first (--yes confirms for a script). --dry-run lists every repo and file it would touch and changes nothing. The otea command itself goes with npm uninstall -g @otea/cli, or the desktop app's uninstaller",
  args: [],
  options: {
    only: { choices: ['repos', 'machine'], placeholder: 'repos|machine' },
    'dry-run': { flag: true },
    'purge-data': { flag: true },
    yes: { flag: true },
  },
  execute: async (input) => {
    const { cwd, flag } = input;
    const dryRun = flag('dry-run');
    const purge = flag('purge-data');
    const only = input.option('only');
    const repoScope = only !== 'machine';
    const machineScope = only !== 'repos';
    const home = resolve(cwd, input.home ?? oteaHome());
    // The data is deleted only when asked for, and once the person (or --yes) has confirmed.
    const targets = purge ? dataTargets(home, cwd, repoScope) : [];
    if (purge && !dryRun && targets.length > 0 && !flag('yes')) {
      const answer = await input
        .ask(
          `Delete ${targets.join(' and ')}? It holds your boards, items and history and cannot be undone. Type "yes" to delete it: `,
        )
        .catch((error: unknown) => {
          throw cancelled(error, 'Cancelled: nothing was deleted') ?? error;
        });
      if (answer?.trim().toLowerCase() !== 'yes') {
        throw new CommandFailure(
          'forbidden',
          'Nothing was deleted: --purge-data needs a "yes" at the prompt, or --yes',
        );
      }
    }
    // The server first, when it is stopped at all: a home is never deleted under a live server, so
    // whatever --only says, purging the data stops it, and one that will not stop refuses the whole
    // run before anything is changed.
    const server =
      machineScope || purge
        ? await uninstallServer(home, OTEA.args.at(-1) ?? '', dryRun)
        : undefined;
    if (purge && !dryRun && server?.failed && targets.length > 0) {
      throw new CommandFailure(
        'forbidden',
        `${server.text}: the Otea data is in use, so nothing was deleted or changed; stop the server (otea serve stop), then run this again`,
      );
    }
    const steps: Step[] = [];
    const lines: string[] = [];
    let repos: RepoReport[] = [];
    let missing: string[] = [];
    if (repoScope) {
      ({ reports: repos, missing } = uninstallRepos(cwd, home, dryRun, input.warn));
      // Each repo says what changed, or what Otea left; one that had nothing of Otea's, one line.
      for (const { path, steps: done } of repos) {
        steps.push(...done);
        const told = done.filter((step) => step.changed || step.kept || step.failed);
        if (told.length === 0) lines.push(`Nothing of Otea's in ${path}`);
        else lines.push(...told.map(({ text }) => text));
      }
      lines.push(...missing.map((path) => `Skipped ${path}: it no longer exists`));
    }
    if (server) {
      steps.push(server);
      lines.push(server.text);
    }
    if (purge) {
      const data = purgeData(targets, dryRun);
      steps.push(...data);
      lines.push(...data.map(({ text }) => text));
    }
    const failed = steps.some((step) => step.failed);
    const left = [
      ...(purge
        ? []
        : [`Your Otea data stays in ${home} (otea uninstall --purge-data deletes it).`]),
      ...(repoScope ? ['If you set a GitHub ruleset, otea hook remove --forge takes it off.'] : []),
      UNINSTALL_LEFT,
    ];
    const head = dryRun ? ['Dry run: nothing was changed.'] : [];
    return {
      data: { dryRun, repos: repos.map(({ path }) => path), missing, steps, left },
      text: [...head, ...lines, ...left].join('\n'),
      ...(failed ? { failure: 'unexpected' as const } : {}),
    };
  },
};

// Side topics (app/topics.ts): what the person asked an agent off the work, kept as a short
// conversation so none is left hanging. The agent records the question and answers it; the person
// keeps it going, closes it or turns it into a task. They are not work: no lease, never in next.
const topicOn: Command = {
  name: 'topic on',
  summary:
    'For the person: keep side topics for this project, so agents record the questions you ask them off the work, with their answers',
  args: [],
  options: {},
  execute: (input) =>
    withProject(input.cwd, (project) => {
      setTopicsOn(project, true);
      return {
        data: { topics: true },
        text: 'Topics are on: agents record the side questions you ask them.',
      };
    }),
};

const topicOff: Command = {
  name: 'topic off',
  summary: 'For the person: stop keeping side topics for this project; the ones kept stay',
  args: [],
  options: {},
  execute: (input) =>
    withProject(input.cwd, (project) => {
      setTopicsOn(project, false);
      return { data: { topics: false }, text: 'Topics are off.' };
    }),
};

const topicAdd: Command = {
  name: 'topic add',
  summary:
    'Record a question the person asked you off the work at hand, not a request to do work, before you answer it (--title, short; --session and --resume when known; --to <id>, a follow-up to that topic); then answer it with topic answer',
  args: ['question'],
  options: { title: {}, to: { placeholder: 'id' }, session: {}, resume: {} },
  execute: (input) => {
    const [question = ''] = input.args;
    const title = input.option('title');
    const to = input.option('to');
    const session = input.option('session');
    const resume = input.option('resume');
    const { actor } = input;
    return withAgent(input, (project) => {
      requireTopicsOn(project);
      const topic = addTopic(project, {
        question,
        actor,
        ...(title === undefined ? {} : { title }),
        ...(to === undefined ? {} : { to }),
        ...(session === undefined ? {} : { session }),
        ...(resume === undefined ? {} : { resume }),
      });
      const done = to === undefined ? `Recorded ${topic.id}` : `Added the follow-up to ${topic.id}`;
      return {
        data: topic,
        text: `${done}. Answer it with otea topic answer ${topic.id} --summary "<short answer>" --full "<your answer as you gave it>".`,
      };
    });
  },
};

const topicAnswer: Command = {
  name: 'topic answer',
  summary:
    'Answer a topic: --summary, a line or two; --full, your whole answer as given in the chat',
  args: ['id'],
  options: { summary: {}, full: {}, session: {}, resume: {} },
  execute: (input) => {
    const [id = ''] = input.args;
    const summary = input.option('summary');
    const full = input.option('full');
    const session = input.option('session');
    const resume = input.option('resume');
    const { actor } = input;
    return withAgent(input, (project) => {
      requireTopicsOn(project);
      const topic = answerTopic(project, {
        id,
        actor,
        ...(summary === undefined ? {} : { summary }),
        ...(full === undefined ? {} : { full }),
        ...(session === undefined ? {} : { session }),
        ...(resume === undefined ? {} : { resume }),
      });
      return { data: topic, text: `Answered ${topic.id}; it is the person's turn.` };
    });
  },
};

// Every project on this computer, open while `use` reads them: the registered ones and the local
// ones a server served (server/hub.ts).
function withEveryProject<T>(use: (served: readonly ServedProject[]) => T): T {
  const machine = openMachine();
  const source = machineProjects(process.env, machine);
  try {
    return use(source.list());
  } finally {
    source.close();
    machine.close();
  }
}

// A project of this computer by id, or by name when no other project has it.
function servedProject(served: readonly ServedProject[], ref: string): Project {
  const byId = served.find((each) => each.id === ref);
  const named = served.filter((each) => each.name === ref);
  if (!byId && named.length > 1) {
    const ids = named.map(({ id }) => id).join(', ');
    throw new OteaError('invalid_name', `Several projects are named "${ref}" (${ids}); use its id`);
  }
  const found = byId ?? named[0];
  if (!found)
    throw new OteaError(
      'not_found',
      `No project "${ref}" on this computer; run otea projects list`,
    );
  if (!found.project)
    throw new OteaError('not_found', found.unavailable ?? `${found.name} is not available`);
  return found.project;
}

const topicList: Command = {
  name: 'topic list',
  summary:
    'List the side topics that wait on someone, what is left hanging first (--all, closed ones too); --search: topics with any of the words, best first, with answers; then items whose threads say them; --all-projects: in every project',
  args: [],
  options: {
    all: { flag: true },
    search: { placeholder: 'words' },
    'all-projects': { flag: true },
  },
  execute: (input) =>
    withReader(input, (project) => {
      const search = input.option('search');
      const filter = { all: input.flag('all'), ...(search === undefined ? {} : { search }) };
      const searching = search !== undefined && search.trim() !== '';
      // What was concluded is often in another project: a question about geo-api asked in
      // ventas-etl (P6-R2-4).
      if (input.flag('all-projects')) {
        const found = withEveryProject((served) =>
          topicsEverywhere(served, project.identity.id, filter),
        );
        return {
          data: searching ? found : found.topics,
          text: topicsEverywhereText(found, search),
        };
      }
      const topics = listTopics(project, filter);
      if (!searching) return { data: topics, text: topicsListText(topics, search) };
      // A search looks in the items' threads too, where a decision is often made (P3C-R2-8).
      const items = searchItems(project, search);
      const text = [topicsListText(topics, search), itemHitsText(items)].filter(Boolean);
      return { data: { topics, items }, text: text.join('\n\n') };
    }),
};

const topicShow: Command = {
  name: 'topic show',
  summary:
    'Show a side topic: its question, answers and notes, with each full answer (--project, of another project)',
  args: ['id'],
  options: { project: { placeholder: 'id or name' } },
  execute: (input) => {
    const [id = ''] = input.args;
    const other = input.option('project');
    return withReader(input, (project) => {
      const topic =
        other === undefined
          ? requireTopic(project, id)
          : withEveryProject((served) => requireTopic(servedProject(served, other), id));
      return { data: topic, text: topicText(topic) };
    });
  },
};

const topicNote: Command = {
  name: 'topic note',
  summary: 'For the person: keep a topic going with a note; the agent that answered it gets it',
  args: ['id', 'text'],
  options: {},
  execute: (input) => {
    const [id = '', text = ''] = input.args;
    return withReader(input, (project) => {
      const topic = noteTopic(project, { id, text, actor: input.reader });
      return { data: topic, text: `Left a note on ${topic.id}; it is the agent's turn.` };
    });
  },
};

const topicClose: Command = {
  name: 'topic close',
  summary: 'For the person: close a topic you have read',
  args: ['id'],
  options: {},
  execute: (input) => {
    const [id = ''] = input.args;
    return withReader(input, (project) => {
      const topic = closeTopic(project, { id, actor: input.reader });
      return { data: topic, text: `Closed ${topic.id}.` };
    });
  },
};

// The conversation with the person (0.8): the secretary alone reads it and answers. The person
// writes only from the desk, so no command here ever makes a message of the person's.
const conversation: Command = {
  name: 'conversation',
  summary:
    "For the secretary: read the person's new messages (marked read), with some context before; --since <id> reads what follows that message, --limit <n> a page",
  args: [],
  options: {
    since: { placeholder: 'id' },
    limit: { placeholder: 'n' },
  },
  execute: (input) => {
    const since = input.option('since');
    const limit = input.option('limit');
    const { actor } = input;
    return withAgent(input, (project) => {
      const from = countFrom('since', since, 0);
      const page = countFrom('limit', limit, 1);
      const read = readAsSecretary(project, {
        agent: actor.name,
        ...(from === undefined ? {} : { since: from }),
        ...(page === undefined ? {} : { limit: page }),
      });
      const { paths, problems, ...rest } = read;
      const messages = read.messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((file) => {
          const path = paths.get(file.id);
          const problem = problems.get(file.id);
          return {
            ...file,
            ...(path === undefined ? {} : { path }),
            ...(problem === undefined ? {} : { pathProblem: problem }),
          };
        }),
      }));
      return { data: { ...rest, messages }, text: conversationText(actor.name, read) };
    });
  },
};

const say: Command = {
  name: 'say',
  summary:
    'For the secretary: tell the person something, short, the conclusion first (- reads stdin). To answer a message: --reply-to <id>, with --request --links <item ids made> or --consultation to classify that turn. Your own news (a review ready, a problem): no --reply-to. A question: 2 to 4 --option answers they tap',
  args: ['text'],
  options: {
    file: { multiple: true, placeholder: 'path' },
    'reply-to': { placeholder: 'id' },
    request: { flag: true },
    consultation: { flag: true },
    links: { placeholder: 'ids', about: 'item ids, comma separated' },
    option: { multiple: true, placeholder: 'text', about: '2 to 4 answers they tap' },
    recommend: { placeholder: 'n', about: 'number (from 1) of the one you pick' },
  },
  execute: async (input) => {
    const [given = ''] = input.args;
    const { actor, cwd } = input;
    const replyTo = input.option('reply-to');
    const options = input.options('option');
    const recommend = input.option('recommend');
    const recommended = recommend === undefined ? undefined : Number(recommend.replace(/^#/, ''));
    if (recommended !== undefined && !Number.isInteger(recommended))
      throw new UsageError('--recommend is the number of an option, from 1');
    if (input.flag('request') && input.flag('consultation')) {
      throw new UsageError(
        'A turn is a request or a consultation: give --request or --consultation',
      );
    }
    const text = given === '-' ? await input.stdin() : given;
    const links = (input.option('links') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    const kind = input.flag('request')
      ? ('request' as const)
      : input.flag('consultation')
        ? ('consultation' as const)
        : undefined;
    return withAgent(input, (project) => {
      const said = sayAsSecretary(project, {
        agent: actor.name,
        text,
        files: input.options('file').map((path) => messageFileAt(resolve(cwd, path))),
        ...(replyTo === undefined ? {} : { replyTo: messageIdOf(replyTo) }),
        ...(kind === undefined ? {} : { kind }),
        links,
        ...(options.length === 0 ? {} : { options }),
        ...(recommended === undefined ? {} : { recommended }),
      });
      const { message } = said;
      const turn =
        message.kind === null
          ? ''
          : ` as a ${message.kind}${message.links.length === 0 ? '' : ` -> ${message.links.join(', ')}`}`;
      const kept = said.kept ? ` The person set this turn as ${message.kind}: that stays.` : '';
      const files =
        message.attachments.length === 0 ? '' : ` with ${message.attachments.length} file(s)`;
      return {
        data: said,
        text: `Said as message ${message.id}${message.replyTo === null ? '' : `, answering ${message.replyTo}`}${files}${turn}.${kept}`,
      };
    });
  },
};

// The Bandeja (0.8): the person's rough captures, which a refiner turns into items. The person
// captures only from the desk, so no command here makes an entry.
const bandeja: Command = {
  name: 'bandeja',
  summary:
    "Read the Bandeja, the person's rough captures: the entries not filed yet (--all adds filed ones), or one (B-3) whole, with file paths and the questions and answers. Refine: bandeja take, then create --from-bandeja, or ask B-3",
  args: ['id?'],
  options: { all: { flag: true } },
  execute: (input) => {
    const [given] = input.args;
    const all = input.flag('all');
    const { reader } = input;
    return withReader(input, (project) => {
      const as = reader.kind === 'agent' ? reader.name : undefined;
      if (given !== undefined) {
        const entry = requireEntry(project, bandejaIdOf(given));
        const { paths, problems } = bandejaPaths(project, [entry]);
        const files = entry.attachments.map((file) => {
          const path = paths.get(file.id);
          const problem = problems.get(file.id);
          return {
            ...file,
            ...(path === undefined ? {} : { path }),
            ...(problem === undefined ? {} : { pathProblem: problem }),
          };
        });
        return {
          data: { ...entry, attachments: files },
          text: entryText(entry, paths, problems, as),
        };
      }
      const entries = listBandeja(project, { filed: all ? 10 : 0 });
      return { data: { entries }, text: listText(entries, as) };
    });
  },
};

// A refiner holds an entry while it works on it, so two never take the same one.
const bandejaTake: Command = {
  name: 'bandeja take',
  summary:
    'Take a Bandeja entry (B-3) to refine it: held 30 minutes (acting on it renews), no other refiner takes it. The secretary takes one for the refiner it launches with --for',
  args: ['id'],
  options: { for: { placeholder: 'refiner' } },
  execute: (input) => {
    const [id = ''] = input.args;
    const { actor } = input;
    const on = input.option('for');
    return withAgent(input, (project) => {
      const { entry, renewed } = takeBandeja(project, {
        id: bandejaIdOf(id),
        agent: actor.name,
        ...(on === undefined ? {} : { on }),
      });
      const { paths, problems } = bandejaPaths(project, [entry]);
      const who = on ?? actor.name;
      const head =
        on !== undefined && on !== actor.name
          ? `Took ${entry.ref} for ${on}: it holds it until ${timeText(entry.claimUntil ?? entry.at)}; it takes it itself with otea bandeja take ${entry.ref} --as ${on}.`
          : `${renewed ? 'Still holding' : 'Took'} ${entry.ref} until ${timeText(entry.claimUntil ?? entry.at)}.`;
      return {
        data: { entry, held: who },
        text: `${head}\n${entryText(entry, paths, problems, actor.name)}`,
      };
    });
  },
};

export const COMMANDS: readonly Command[] = [
  init,
  projectsList,
  projectsCurrent,
  projectsLang,
  projectsAdd,
  projectsRelink,
  projectsForget,
  reposList,
  reposAdd,
  reposRemove,
  migrateCommand,
  connect,
  collectionIconCommand,
  create,
  list,
  show,
  boardAdd,
  boardDraft,
  board,
  promptCommand,
  brief,
  events,
  stats,
  wait,
  claim,
  profileCommandSpec,
  whoami,
  heartbeat,
  release,
  update,
  attach,
  detach,
  link,
  unlink,
  next,
  reply,
  crop,
  merged,
  reopen,
  tick,
  topicOn,
  topicOff,
  topicAdd,
  topicAnswer,
  topicList,
  topicShow,
  topicNote,
  topicClose,
  conversation,
  say,
  // The longer name first: a command is the first whose words all match.
  bandejaTake,
  bandeja,
  ask,
  answer,
  handoffCommand,
  dropCommand,
  approveCommand,
  sendBack,
  move,
  relay,
  validate,
  check,
  hookInstall,
  hookRemove,
  uninstall,
  start,
  // The longer names first: a command is the first whose words all match.
  serveStart,
  serveStop,
  serveStatus,
  serve,
  open,
  devicesList,
  devicesRevoke,
  ...PHONE_COMMANDS,
  mcp,
];

export function findCommand(tokens: readonly string[]): Command | undefined {
  return COMMANDS.find((command) =>
    command.name.split(' ').every((word, index) => tokens[index] === word),
  );
}

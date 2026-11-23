import { agentPrompt } from '../core/agent-prompts.ts';
import { isListedKey, type Lang } from '../core/board/templates.ts';
import { OteaError } from '../core/errors.ts';
import { promptFacts, promptKindOf } from './agent-prompts.ts';
import { listBoardSummaries } from './boards.ts';
import { type InitBoard, initBoards, NO_BOARDS } from './init-boards.ts';
import {
  initProject,
  openProject,
  type Project,
  type ProjectView,
  projectView,
} from './project.ts';
import { projectLanguage } from './project-language.ts';
import { listRepos } from './repos.ts';

// otea start: what a person needs in their first minutes, in the project's folder, in one pass.
// The project is set up when it is not (otea init), a first board is made from a template when the
// person picks one and the project has none of its own, and the text to paste into the agent's chat
// is the one otea prompt prints. Every step looks before it acts: run again, nothing that exists
// is touched and the report says what was already there. The background server and the MCP line
// are the command's (they need the CLI's launcher).

export type StartReport = {
  project: ProjectView & { root: string; dataDir: string; storage: Project['storage'] };
  // Whether this run set the project up.
  created: boolean;
  boards: {
    // The boards this run made.
    made: InitBoard[];
    // Every board of the project's own, by name, with the ones made now.
    all: string[];
  };
  prompt: string;
  // The language of the boards and the prompt: --lang once, else the project's.
  lang: Lang;
};

export type StartOptions = {
  // A template key (or `none`), as init --template takes it.
  template?: string | undefined;
  // Forces the language of this run's boards and prompt. A project being made is made in it; one
  // that exists keeps its own, which `otea projects lang` changes.
  lang?: Lang | undefined;
  // Asked once, only when nothing was named and the project is new: the key the person picks, or
  // nothing to leave the boards to the agent. A project that exists is never asked again, so a
  // second run does not nag the person who left the boards to their agent.
  choose?: () => Promise<string | undefined>;
};

// A typo fails before anything is made.
function assertTemplate(key: string | undefined): void {
  if (key !== undefined && key !== NO_BOARDS && !isListedKey(key)) {
    throw new OteaError('not_found', `There is no template ${key}`);
  }
}

export async function startProject(cwd: string, options: StartOptions): Promise<StartReport> {
  const { template } = options;
  assertTemplate(template);
  let project: Project | undefined;
  try {
    project = openProject(cwd);
  } catch (error) {
    if (!(error instanceof OteaError) || error.details?.kind !== 'no_project') throw error;
  }
  const created = project === undefined;
  let picked = template;
  if (project === undefined) {
    // What the person types is checked before the project is made, so a typo leaves nothing behind.
    if (picked === undefined) picked = (await options.choose?.()) || undefined;
    assertTemplate(picked);
    project = initProject(cwd, options.lang === undefined ? {} : { lang: options.lang });
  }
  try {
    const lang = options.lang ?? projectLanguage(project);
    if (created) listRepos(project);
    const made = initBoards(project, picked, lang);
    const moment = promptKindOf(project);
    const { root, dataDir, storage } = project;
    return {
      project: { ...projectView(project), root, dataDir, storage },
      created,
      boards: {
        made,
        all: listBoardSummaries(project)
          .filter(({ builtin }) => !builtin)
          .map(({ name }) => name),
      },
      prompt: agentPrompt(moment, lang, promptFacts(project, moment)),
      lang,
    };
  } finally {
    project.db.close();
  }
}

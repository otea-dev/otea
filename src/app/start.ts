import { agentPrompt } from '../core/agent-prompts.ts';
import { isListedKey, type Lang } from '../core/board/templates.ts';
import { OteaError } from '../core/errors.ts';
import { promptFacts, promptKindOf } from './agent-prompts.ts';
import { listBoardSummaries } from './boards.ts';
import { hasOwnBoards, type InitBoard, initBoards, NO_BOARDS } from './init-boards.ts';
import {
  initProject,
  openProject,
  type Project,
  type ProjectView,
  projectView,
} from './project.ts';
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
};

export type StartOptions = {
  // A template key (or `none`), as init --template takes it.
  template?: string | undefined;
  lang: Lang;
  // Asked once, only when nothing was named and the project has no board of its own yet: the key
  // the person picks, or nothing to leave the boards to the agent.
  choose?: () => Promise<string | undefined>;
};

export async function startProject(cwd: string, options: StartOptions): Promise<StartReport> {
  const { template, lang } = options;
  // A typo fails before anything is made.
  if (template !== undefined && template !== NO_BOARDS && !isListedKey(template)) {
    throw new OteaError('not_found', `There is no template ${template}`);
  }
  let created = false;
  let project: Project;
  try {
    project = openProject(cwd);
  } catch (error) {
    if (!(error instanceof OteaError) || error.details?.kind !== 'no_project') throw error;
    project = initProject(cwd);
    created = true;
  }
  try {
    if (created) listRepos(project);
    let picked = template;
    if (picked === undefined && !hasOwnBoards(project)) picked = await options.choose?.();
    const picks = picked === undefined || picked === '' ? undefined : picked;
    const made = initBoards(project, picks, lang);
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
    };
  } finally {
    project.db.close();
  }
}

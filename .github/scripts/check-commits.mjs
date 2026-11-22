// Checks that every commit of a pull request is a conventional commit with a type release-please
// understands. Pull requests merge by rebase, so each commit lands on main as it is, and
// release-please reads its subject to pick the next version and write the changelog.
//
// Run by .github/workflows/commits.yml:  node .github/scripts/check-commits.mjs <base> <head>
// It checks the commits reachable from <head> and not from <base>. No dependency: Node and git.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The types of "changelog-sections" in release-please-config.json.
export const TYPES = [
  'feat',
  'fix',
  'perf',
  'revert',
  'docs',
  'chore',
  'ci',
  'build',
  'test',
  'refactor',
  'style',
];

const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^()\\s][^()]*\\))?!?: \\S`);
// What GitHub writes itself: the Revert button, and a merge of main into a branch.
const GITHUB_MADE = /^(Revert ".+"|Merge (pull request #\d+ |branch |remote-tracking branch ).+)$/;

// Why a commit subject is not accepted, or undefined when it is.
export function problemWith(subject) {
  if (CONVENTIONAL.test(subject) || GITHUB_MADE.test(subject)) return undefined;
  return `not a conventional commit: expected "<type>(<scope>)<!>: <subject>", with type one of ${TYPES.join(', ')}`;
}

function main(base, head) {
  if (!base || !head) {
    console.error('usage: check-commits.mjs <base> <head>');
    return 2;
  }
  const log = execFileSync('git', ['log', '--format=%H%x09%s', `${base}..${head}`], {
    encoding: 'utf8',
  });
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });
  let bad = 0;
  for (const { sha, subject } of commits) {
    const problem = problemWith(subject);
    if (problem) {
      bad++;
      console.log(`::error title=Commit message::${sha.slice(0, 8)} "${subject}" is ${problem}`);
    }
  }
  console.log(`commits ${commits.length - bad}/${commits.length} ok`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2], process.argv[3]);
}

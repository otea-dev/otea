// From about 190 characters of repo path, git on Windows fails every push from a linked worktree
// ("fatal: '$GIT_DIR' too big"), and the agent text puts each item's worktree at
// .otea/worktrees/<id> inside the repo. A margin under that is warned (field study 4, T1c).
export const LONG_PATH_BYTES = 170;

// What to tell the person about the project's folder, or undefined when it is short enough or the
// system is no Windows (git's limit there is the system's path length, not git's own).
export function longPathNote(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const bytes = Buffer.byteLength(root);
  if (platform !== 'win32' || bytes <= LONG_PATH_BYTES) return undefined;
  return `This project's folder path is ${bytes} bytes long. On Windows, git fails to push from a worktree (.otea/worktrees/<id>, where agents work) once the repo path passes about ${LONG_PATH_BYTES} bytes ("fatal: '$GIT_DIR' too big"), so an agent would stop at its first push. Move the repo to a shorter path (C:\\src\\<name>, say), then tell Otea with otea projects relink <old path> <new path>.`;
}

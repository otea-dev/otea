// The process that started this one, read the moment the command begins, before anything else
// loads. A wait whose parent shell ends while the command still starts up would otherwise read
// `process.ppid` after that: on macOS and Linux an orphan's parent is the system's own process
// (pid 1), which never ends, so the wait watched nobody and ran to its timeout. main.ts imports it
// first, so it is evaluated before the commands load.
export const STARTED_BY = process.ppid;

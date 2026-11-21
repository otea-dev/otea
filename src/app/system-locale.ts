// Where the system's own locale is read from; tests replace it, so no result depends on the computer
// they run on. Its own module, with no imports: the test setup file loads it in every test, UI tests
// included, and a UI test cannot load what reaches node:sqlite (the store) on Node 22.
export const system = {
  locale: (): string => Intl.DateTimeFormat().resolvedOptions().locale,
};

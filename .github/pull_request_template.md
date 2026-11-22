## What and why

<!-- One to three lines: what changes, and the reason. -->

## How it was verified

<!-- The commands you ran and what they said (`npm run check`, a single test file...). For UI, a capture. -->

## Risk or rollback

<!-- One line: what could break, and how to undo it. -->

## Checklist

- [ ] Every commit is a [conventional commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...): pull requests merge by rebase, so each one lands on `main` as it is
- [ ] Behaviour changes come with a test that fails without them
- [ ] No secrets, LAN IPs or hostnames in this text, the commits or the captures

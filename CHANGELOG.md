# Changelog

## [0.5.0](https://github.com/otea-dev/otea/compare/v0.4.0...v0.5.0) (2026-11-23)


### Features

* **cli:** say in the event timeline where each of the person's moves came from ([b754c41](https://github.com/otea-dev/otea/commit/b754c41ce6e8d76f863506e99adc834e995b05ee))
* **history:** record whether a human move came from the desk, the phone or a direct API call ([4dc6864](https://github.com/otea-dev/otea/commit/4dc68644b8d87c423a704a03c2217b8eff7d14ae))
* **history:** say in the item history where each of the person's moves came from ([dc8e836](https://github.com/otea-dev/otea/commit/dc8e836f35716b06d6d19632d1f8e1e09eacf88f))
* **review:** warn when the attached diff names other files than the work handed off changes ([a6b88d2](https://github.com/otea-dev/otea/commit/a6b88d29a28b2a9af86b40d032f898510fdbe82b))
* **settings:** show which Otea runs, with a copyable report for bugs ([42fbe7e](https://github.com/otea-dev/otea/commit/42fbe7eb078940a18f3363b1a856d3c0923b6ee9))
* **ui:** show the diff and landed file lists in review, on the desk and the phone ([03c89e5](https://github.com/otea-dev/otea/commit/03c89e5b5369fa654b3699ae0f850673a14cb2d8))


### Bug fixes

* **board:** make any move into a land step the person's alone, a send-back included ([1c4433b](https://github.com/otea-dev/otea/commit/1c4433b5dfcd5eb87eb7ff7e008e0778ed27b173))
* **boards:** read a level in next in the board's language, and take a choice by its key ([3136175](https://github.com/otea-dev/otea/commit/31361754b207827e1ef880d4970d0c6dbd6efb40))
* **boards:** read a yes-or-no value in the board's language ([07f6c68](https://github.com/otea-dev/otea/commit/07f6c68a31767913c2d87bb1876330a4a9b991ee))
* **cli:** review round on the round-7 CLI fixes ([37834e5](https://github.com/otea-dev/otea/commit/37834e5fcfc39a0846670a95b5518e634f727536))
* **cli:** round-7 CLI findings (wait, connect, open, relay, main queue, owner) ([08d0011](https://github.com/otea-dev/otea/commit/08d001154e2c14cc4648ed85fa439a2d3f686111))
* **handoff:** ignore prunable worktrees and worktrees whose folder is gone over MCP ([99d09d8](https://github.com/otea-dev/otea/commit/99d09d8681af238ddc68de15357ca9a22bac50f0))
* **handoff:** judge only the commits that change files, whatever the diff config says ([01600d3](https://github.com/otea-dev/otea/commit/01600d38b07ce4930bef2c2beb3adea52e25bd90))
* **handoff:** refuse a landed commit that changes no files ([37607ab](https://github.com/otea-dev/otea/commit/37607abc96402881104a5b01e582a4a470d0e4a6))
* **handoff:** refuse over MCP a branch no checkout of the repository has checked out ([56a87b4](https://github.com/otea-dev/otea/commit/56a87b40d100da5cce57d1a04ac79cb01eaad1f0))
* **items:** keep a later step's field as it is while the item waits in review ([cbc2c61](https://github.com/otea-dev/otea/commit/cbc2c61d4027693cd7f22295eab8deea925c4ee8))
* **items:** let anytime fields and unchanged values through the review lock, and use langOf in next ([1254547](https://github.com/otea-dev/otea/commit/12545471f0fe2674748ea70e738920f8e8b40559))
* **language:** harden the project language and make the desk's agent prompt follow it ([5d51a45](https://github.com/otea-dev/otea/commit/5d51a455722011d83edfd72418dca9c5612e19b5))
* **language:** keep the language of otea start, prompt and boards with the project, not the desk ([2870b5f](https://github.com/otea-dev/otea/commit/2870b5fa1467557009fb92125b0f87681ca56f08))
* **offline:** never answer /api/version from the service worker's cache ([6639711](https://github.com/otea-dev/otea/commit/6639711f64e6e65f45fff1c6c0bb5f71b9a1e65c))
* **review:** warn when the work changes no file, and read paths as git writes them ([e3761fb](https://github.com/otea-dev/otea/commit/e3761fba4c8e679ffddaddd975fa52448312285e))
* **serve:** never tell anyone to stop a server that is not the background one ([5603319](https://github.com/otea-dev/otea/commit/5603319f69885a980bef4d6b0bfad7172cd01499))
* **serve:** say when the background server is not the installed Otea ([9f028c6](https://github.com/otea-dev/otea/commit/9f028c6eae72fccce4affb23876b5ceb58c33151))

## [0.4.0](https://github.com/otea-dev/otea/compare/v0.3.0...v0.4.0) (2026-11-23)


### Features

* **cli:** otea start, the first minutes in one command ([1c54ba0](https://github.com/otea-dev/otea/commit/1c54ba0267219cd0f5e38f624ec704a2a8df702c))
* **cli:** start says how to get a board, init knows a desk runs, --lang on start and init ([5c45420](https://github.com/otea-dev/otea/commit/5c45420ce774a1facdb64c3810057b0746e0a95b))
* **handoff:** the handoff line says when a new file has the bytes of the round before ([a0552ae](https://github.com/otea-dev/otea/commit/a0552ae5ca66c88f2425f747f94a883d660da78a))
* **prompts:** lay the first-contact prompt out as steps with a line for each thing to do ([0969930](https://github.com/otea-dev/otea/commit/09699302062747164d33c080aca0968504fb0161))
* **repos:** next and claim say a remote was added after init, with the command ([21cff02](https://github.com/otea-dev/otea/commit/21cff0262a28382950ed05dd0ed98d17044c957e))
* **server:** agents per project in the overview, Rendimiento across projects ([9d1dc20](https://github.com/otea-dev/otea/commit/9d1dc20d80573e0032d17bd5e5b24c6c691c14ef))
* **start:** say which template to pick when no board was made ([a1b1c70](https://github.com/otea-dev/otea/commit/a1b1c70a8cbd469f32825c2c7689d404d3d4ce75))
* **ui:** a calm next step after the first finished item ([3d8a0f6](https://github.com/otea-dev/otea/commit/3d8a0f6e032dad8788adc32d18555dfc1a3c4db0))
* **ui:** Configuracion in plain sections, jargon behind Avanzado ([0d700c4](https://github.com/otea-dev/otea/commit/0d700c4cd5de2428e0a840dc30d2540498702210))
* **ui:** per-project state in the switcher, agents and Rendimiento across projects ([b37310b](https://github.com/otea-dev/otea/commit/b37310b5ee776d155e4f61a988cbd76c716ea332))
* **ui:** plain words in Connect an agent, technical detail behind a disclosure ([c3da430](https://github.com/otea-dev/otea/commit/c3da4306828d77661f4d1382be1126edec8beb9b))
* **ui:** search the items on the phone; keep the install banner off the next-step card ([6b1a45e](https://github.com/otea-dev/otea/commit/6b1a45e9de73d575fdebf3560a898fbde773562d))
* **ui:** the create button reads as an action ([6a2a64a](https://github.com/otea-dev/otea/commit/6a2a64ad9610249a966f5715a00340b2dda28ce1))


### Bug fixes

* a connected agent whose lease lapsed reads connected, the lease keeps its own word ([6e9706f](https://github.com/otea-dev/otea/commit/6e9706f05d939fdb6f0fa15b808400136d835856))
* **boards:** evidence groups new each round, plural counts, short-group approval, reader framing ([d1e640a](https://github.com/otea-dev/otea/commit/d1e640a1df80ecd5c5e22f73aa85d7781290481c))
* **boards:** review of the evidence-groups PR (confirm resets, reader flow, group invariants) ([15bdd5d](https://github.com/otea-dev/otea/commit/15bdd5da70e74c71b4b9a03103fb309bfa03cc28))
* **cli:** boards made from the command line follow the person's language ([5b1440c](https://github.com/otea-dev/otea/commit/5b1440c36520dfae127a5c77bc1ae413f1040b42))
* **cli:** daemon port memory, single-use sign-in links, wait units, MCP schemas, connect --cli ([4bdaba5](https://github.com/otea-dev/otea/commit/4bdaba569c73803edcb6c58284ee859b62b23e18))
* **cli:** fail toward git in the .git walk, ship every bundled license, try the packed package in CI ([2827d43](https://github.com/otea-dev/otea/commit/2827d43ab46c8cca5d27123cd4abe95222da3e66))
* **cli:** init takes no --lang, as its contract says ([11a0854](https://github.com/otea-dev/otea/commit/11a08541de16ce5958dcc27dda4aaaba8f485feb))
* **cli:** review of the single-use link, hook refresh, MCP params and port memory ([e73037c](https://github.com/otea-dev/otea/commit/e73037c30f14e4fa19c7802c7fdb79574d06da15))
* **connect:** say each thing once and the PATH difference as a note ([5105fd9](https://github.com/otea-dev/otea/commit/5105fd9e9e69e251537ca7a6ac54c012f1af2888))
* **desk:** keep «sin señal» for a silent agent, show silent and away together, say it on the sheet ([d7d366e](https://github.com/otea-dev/otea/commit/d7d366e25cf86c7967da42050f54a775497f9898))
* **desk:** one word for an agent whose lease ran out, a plain line for a connected one ([5e5fc85](https://github.com/otea-dev/otea/commit/5e5fc85022f05d4afc592ee32d1ee089c28a753f))
* **gates:** a write on an item waits its turn to land like the claim ([39c7195](https://github.com/otea-dev/otea/commit/39c7195ec2fc23ec2838a3c6f4a6273957f80b1d))
* **gates:** close the last holes of the landed-commit check and of main ([1e9c58d](https://github.com/otea-dev/otea/commit/1e9c58d3df64a52672b55dca85c420f165516283))
* **gates:** Code on main takes one agent at a time, adapts to no remote, checks the commit ([b57a589](https://github.com/otea-dev/otea/commit/b57a5890439e0337e1f088cb151203909daffa47))
* **gates:** count only landed items as owners, and tell the item's own commit by what the base held at its claim ([4190c4a](https://github.com/otea-dev/otea/commit/4190c4a3f3d852b7355aa932d7ab12878538013a))
* **gates:** only the item's first claim tells what the base held, and git runs before the claim's transaction ([738fcb3](https://github.com/otea-dev/otea/commit/738fcb33fea9f0121c8e12e138c7c22684e5ae93))
* **gates:** read git's messages in English when checking the landed commit ([0611442](https://github.com/otea-dev/otea/commit/0611442555972510bccd409c24c20896f4e1db29))
* **gates:** review of the gates (way Done, approved work, fetch, one change on main, write over a running holder) ([4c3f795](https://github.com/otea-dev/otea/commit/4c3f79520d3f9bdae9df7560e9a658ed19e58c60))
* **gates:** the landed commit must be the item's own ([577c794](https://github.com/otea-dev/otea/commit/577c794de342dba6f3e8eff99eb2b1b211f8615f))
* **mcp:** keep other tools' flags and JSON drafts whole, name repeated options as arrays ([f42a986](https://github.com/otea-dev/otea/commit/f42a9869302eaee24690cfb10faec2ba713d3dd4))
* **mcp:** rewrite a flag only outside other tools' command lines, leave --field-file, point file - to definition ([391e040](https://github.com/otea-dev/otea/commit/391e0401e3d000d091d3c94a082e05547c9c59bc))
* one agent vocabulary on every surface, calm between rounds ([f59a1d7](https://github.com/otea-dev/otea/commit/f59a1d71e8bc73f2dc5672ea6c1a5840a5851c09))
* **phone:** review of round-5 phone fixes (draft lifecycle, handed fields, install flicker) ([26fe8e9](https://github.com/otea-dev/otea/commit/26fe8e932f3fa5d5c0a279241a015e3b4f4b83fa))
* **phone:** unreadable photo and install feedback, log search fit, closed item rounds, Studio why ([966f377](https://github.com/otea-dev/otea/commit/966f377f65d9fb5d820d487b05881e24d6b61870))
* **project:** answer the path git answers when the folder is reached through a link ([2aa1662](https://github.com/otea-dev/otea/commit/2aa166240928cb6515af082af199df659948f760))
* **relay:** approvals that land or close are the person's, and relayed words show as relayed everywhere ([5ac46f2](https://github.com/otea-dev/otea/commit/5ac46f2fc1d3f0748408c995aa8e392671a7d2e0))
* **relay:** show a relayed decision as relayed, never the person's own, and let a board turn relay off ([9f86db7](https://github.com/otea-dev/otea/commit/9f86db7165b58effa3dd60ec930934f63358d40f))
* review of first contact (note vs prompt, prompt language, start edge cases, card age) ([cbae4a0](https://github.com/otea-dev/otea/commit/cbae4a0d60dc58f5a9b14d692003ddbb8bcbaffc))
* review of settings and projects (approvals after publish, typed status, safer cross-project reads, throttled picker, folder path, table width) ([c89e6cb](https://github.com/otea-dev/otea/commit/c89e6cb7bbc4ea9e9ac8b785fcc872eb38df9ad0))
* review of the first-contact PR (language rule, card race, start report, tests) ([717ebed](https://github.com/otea-dev/otea/commit/717ebedad241c113250d50ffa991e23d79736dd4))
* review of the remote-added notice, connect and README ([b7c6d5d](https://github.com/otea-dev/otea/commit/b7c6d5d6c26cf8a09122db4b898f7ef04f449549))
* **review:** say when a round attached the same file as the round before ([f877fcb](https://github.com/otea-dev/otea/commit/f877fcb178502eb22b183e55e9cd8cb7c438e774))
* **signin:** keep the sign-in going when removing a redeemed link's file is refused ([d6548f6](https://github.com/otea-dev/otea/commit/d6548f60bd8686291cc11421d5f3fc7ae03ea6f5))
* **signin:** use a sign-in link up by creating a mark file that only one process can create ([b57946b](https://github.com/otea-dev/otea/commit/b57946b9e1ad9b71a0e69d738a6f4ee393ea9565))
* **triage:** approving with a group short asks once, by press and by swipe ([5f9217f](https://github.com/otea-dev/otea/commit/5f9217f771752de181e488375116dff7951b8309))
* **ui:** classify a refused read before noting it ([c8f94ef](https://github.com/otea-dev/otea/commit/c8f94efd6a69a9656e20a6a9eec5bc7d6ee4ff65))
* **ui:** count only approvals of an agent's work in the day's recap ([42ecb44](https://github.com/otea-dev/otea/commit/42ecb44cc41e7415c8a58c232c5965d7a5297e61))
* **ui:** keep the stuck row's mark short beside «reserva vencida» ([3727567](https://github.com/otea-dev/otea/commit/3727567dcd464a27494231a32b0ab20e80c012ed))
* **ui:** review round on the phone search and the signed-out page ([a168d04](https://github.com/otea-dev/otea/commit/a168d04ad672d543ee8e03bc4d516cb919091232))
* **ui:** say the session ran out instead of showing an empty desk ([aef2d5d](https://github.com/otea-dev/otea/commit/aef2d5d8114f96bfe9fd6a831aeff1456ab0efee))
* **ui:** the next-step card counts only real work and rests below the queue ([ba1d6b0](https://github.com/otea-dev/otea/commit/ba1d6b0b7714c3ef8eeb632e1595831050d7696a))


### Performance

* **cli:** bundle the CLI with esbuild and answer --version before the commands load ([d066d91](https://github.com/otea-dev/otea/commit/d066d91ba9452bf4bb15c883103d75b522252eaf))
* **cli:** read the checkout kind and the branch from .git instead of spawning git ([f29ddc0](https://github.com/otea-dev/otea/commit/f29ddc02bcd26e850af0fe0bfdf7a291e1ee41bc))
* **project:** find the git common dir by walking up to .git instead of spawning git ([31073af](https://github.com/otea-dev/otea/commit/31073af8711a6b0c45dff11d45651a888be4cdf6))

## [0.3.0](https://github.com/otea-dev/otea/compare/v0.2.0...v0.3.0) (2026-11-22)


### Features

* **agents:** brief next and show, structured MCP results, normal wait timeout ([cf8c9fa](https://github.com/otea-dev/otea/commit/cf8c9faa182be749cd4cc3dc14c615f2bb765468))
* **boards:** ask for at least N of a group of evidence, hide empty optional evidence in review, refuse empty files, and list accepted extensions ([6faaf48](https://github.com/otea-dev/otea/commit/6faaf48ac59b71cff0aa368f260f4ef90b8ba0d4))
* **boards:** keep a template's words on the board in every language, and read them in the language on screen ([ab0ee1d](https://github.com/otea-dev/otea/commit/ab0ee1d4acf32eb7f50b810bbbdb27e682d83f97))
* **cli:** add otea uninstall, which takes Otea's footprint off every repo and the machine ([de99e42](https://github.com/otea-dev/otea/commit/de99e427b1e32d5a56628ced5a9f043e75881ced))
* **cli:** tell once a day when npm has a newer @otea/cli ([c8c3c81](https://github.com/otea-dev/otea/commit/c8c3c81eececf6b9d3d312182db383b384821b6a))
* **ui:** show a group's row in the hand checklists and Studio's preview, and keep the review's gaps in the evidence column ([53b23bd](https://github.com/otea-dev/otea/commit/53b23bd8a44bec99f7bd71311d1dc725f4693f2a))


### Bug fixes

* **agents:** brief is opt-in, no structuredContent, next orders by approvals ([65f624a](https://github.com/otea-dev/otea/commit/65f624a94474cdf7a274194127336a8b7fbf6c96))
* **boards:** count groups when publishing, never skip past an unmet group, count a file once, let a group member be new each round, and pin the file part's placement and headers ([333c903](https://github.com/otea-dev/otea/commit/333c9033cabb8eef6868630d3a725249653668a7))
* **boards:** keep the snapshot through a language switch under an open editor, an agent's merge, and a re-read ([0402301](https://github.com/otea-dev/otea/commit/040230166028da5e6fe8c9af6d51c003ddd9c8d1))
* **boards:** require readIn on every draft save, and send it from the pair undo-discard ([2bfbf91](https://github.com/otea-dev/otea/commit/2bfbf91fc265c0ec8dafaedad48a871c58af1901))
* **cli:** keep a repo the same repo when a remote is added after init ([4802099](https://github.com/otea-dev/otea/commit/48020990f0b556d02941e2dfdc6d9bf8d0c991a2))
* **cli:** make uninstall delete only what is exactly Otea's, and never write to the home it removes ([8ff2b5a](https://github.com/otea-dev/otea/commit/8ff2b5a68f3a42deb8f5b00e5ea5e0fe17c46c8c))
* **cli:** match a repo by root commit only while it has no origin, delete only a hook that is exactly Otea's, and harden the purge guard ([1c2e121](https://github.com/otea-dev/otea/commit/1c2e1213ade52150b29ec8bf74ad94c6d4d18000))
* **cli:** refuse to purge a home whose registry cannot be read, and tell an agent to ask first ([6d7c971](https://github.com/otea-dev/otea/commit/6d7c971ce712da691ac508eb7b67ab12d23128e1))
* **mcp:** list uninstall among the CLI-only commands ([95ffddc](https://github.com/otea-dev/otea/commit/95ffddccad1b50132be01ef2a640d2dcd9b50bbf))
* **presence:** one agent status for the desk, the CLI and MCP ([8fce2db](https://github.com/otea-dev/otea/commit/8fce2dbd34c48a0e794c776bd4ea70d3ea337939))
* **presence:** one status for every consumer, rename told by the agent ([fc97914](https://github.com/otea-dev/otea/commit/fc97914c9b19d009512338918618f1a8f934caf5))
* **presence:** only whoami tells a rename; heartbeat every 90 seconds ([06cb884](https://github.com/otea-dev/otea/commit/06cb8844015502fdbb6c262a6cbdc8cbc7c5c2cb))
* **templates:** --description fills the first long text the form asks, and To add one offers no attachment as a field ([4581c49](https://github.com/otea-dev/otea/commit/4581c491375c26104a65073f0d9f545fd074b6ba))
* **ui:** break a long title in the phone's fold summary, and pin the tab bar height in the phone CSS test ([a60c3ca](https://github.com/otea-dev/otea/commit/a60c3cad782d7cf818944e74d0da87357636896d))
* **ui:** keep line breaks without doubling hard breaks, align the form's textarea, and harden the update notice ([d47ccba](https://github.com/otea-dev/otea/commit/d47ccba9b58968d06e5375ca94edc74446e7721d))
* **ui:** keep the agent status the server sends when reading presence ([4b33fbc](https://github.com/otea-dev/otea/commit/4b33fbceacc02373afe7a2f738cd169f47083c38))
* **ui:** polish the web desk's layout on desktop and phone, and tell the user an update restart is under way ([2a73243](https://github.com/otea-dev/otea/commit/2a73243364e37064f7c54de565fb8d1ebb5a5fb0))
* **ui:** say a silent agent's item in its menu row ([0981059](https://github.com/otea-dev/otea/commit/098105966b9e9c1ec8c5b29462ad698e2eaf34f8))

## [0.2.0](https://github.com/otea-dev/otea/compare/v0.1.1...v0.2.0) (2026-11-22)


### Features

* **cli:** run otea serve as a detached daemon with serve start, stop and status ([25e6077](https://github.com/otea-dev/otea/commit/25e6077a2ad1dcdfa579ec078fac19c4b9e18db3))
* **server:** answer the API only to a signed-in browser or a paired device ([4d0f3f6](https://github.com/otea-dev/otea/commit/4d0f3f683c47f5bf1e55902c701ea84a8979ab35))


### Bug fixes

* **cli:** keep the daemon's log private, never orphan a live server, serialise starts ([853cc1e](https://github.com/otea-dev/otea/commit/853cc1e73e7641753c6b4ae52bd4a182087ffee3))
* **cli:** start the server through ShellExecute on Windows so it never holds the caller's pipe ([03bfff0](https://github.com/otea-dev/otea/commit/03bfff039d00d0c277722bd98f4adf2f8d7ce563))
* **cli:** tighten what serve stop may kill, and two small races ([b8c5fb6](https://github.com/otea-dev/otea/commit/b8c5fb64b26aec41cd52a87ef651d6d410b19904))

## [0.1.1](https://github.com/otea-dev/otea/compare/v0.1.0...v0.1.1) (2026-11-22)


### Bug fixes

* **connect:** print the absolute path of the running Otea, never an otea found on PATH ([e5d0e40](https://github.com/otea-dev/otea/commit/e5d0e40d555746842435e53bb5c612590f64c235))
* **connect:** trust the otea on PATH only when it is this install ([7429e8d](https://github.com/otea-dev/otea/commit/7429e8dfb5713aaf0d2cf4aec37a94c859bc3eb9))
* **desktop:** give the development app its own Windows app id ([f559566](https://github.com/otea-dev/otea/commit/f55956677fbb9722d1bcb311be3d5e975e406c96))
* **hook:** fail open only when a file the hook names is gone, and quote paths safely ([cbcbbc0](https://github.com/otea-dev/otea/commit/cbcbbc04e3c70046ffe025849a45eb0276141b20))
* **hook:** let a push through, with one stderr line, when the Otea the pre-push hook runs is gone ([e7eeb1a](https://github.com/otea-dev/otea/commit/e7eeb1a6ff6fe50157f044c781092c237899f647))
* **launcher:** escape backslashes in a quoted shell word ([d723d59](https://github.com/otea-dev/otea/commit/d723d594b145d5f159e6faab084b7e7bef54d5cf))
* **notes:** an agent answers the person's notes before taking an item back a step, so a note left in the land step is not lost ([f85ed22](https://github.com/otea-dev/otea/commit/f85ed222d5ce361c030556a8358d5b333a4b849e))
* **questions:** a move the person took back no longer closes a waiting question ([44c6a24](https://github.com/otea-dev/otea/commit/44c6a24be6ba60e1c6572edd912e741ffdb86673))
* **store:** close a database whose setup fails, for the project, registry and machine stores ([2021496](https://github.com/otea-dev/otea/commit/2021496f95764ca1222316df19e241b07c00be3e))
* **ui:** centre Rendimiento and Configuración like the other desk views ([d2935ad](https://github.com/otea-dev/otea/commit/d2935ad27e5a55b080b7db4f9420a1945eb0a0b6))
* **ui:** lay out the Temas view like the other desk views ([539ab30](https://github.com/otea-dev/otea/commit/539ab306947ae0b03cf308617607a349da82edd5))

## 0.1.0 (2026-11-22)


### Features

* **agents:** give agents Otea's guide once, with no copy in AGENTS.md ([788ad7a](https://github.com/otea-dev/otea/commit/788ad7a9980e2af93161a711d7d08c1a2f06bf9c))
* **desktop:** bring the window to the front when an agent asks only if the person chose it ([1dafe6f](https://github.com/otea-dev/otea/commit/1dafe6f57db004d9d768e780b0456c35befe01a3))
* **init:** give a project one language for the words it makes, with otea init --lang ([3ba2461](https://github.com/otea-dev/otea/commit/3ba2461c079849c720b6b1021ab4e089bb7bc146))
* **language:** what Otea makes takes the language the person uses, kept by the server ([baa2052](https://github.com/otea-dev/otea/commit/baa205202f2d7608815beec5e43c8f41c6b671cc))
* **mcp:** answer tool calls with the CLI's text, not the item as JSON ([df7a30b](https://github.com/otea-dev/otea/commit/df7a30bd144b8240d396e77fba4bfa1aeab34145))
* **ui:** move the notification and window preferences to a Preferences page ([aef3f5f](https://github.com/otea-dev/otea/commit/aef3f5f206db985481223c8967b9cfb2ccdc19c3))
* **ui:** put the app name first in the window title, Otea · project (1) ([deee045](https://github.com/otea-dev/otea/commit/deee0451ecefd8889e74e467e6e4e8829f4f9fd9))


### Bug fixes

* **desktop:** install the Windows app in Programs\Otea, not Programs\otea-desktop ([c67b56c](https://github.com/otea-dev/otea/commit/c67b56c187dfe7102b1dc7928c9714783bb19f84))
* **desktop:** keep the window on the project server and validate every IPC caller and argument ([2da2a94](https://github.com/otea-dev/otea/commit/2da2a94e044ae9e74204eced2657164ca040999e))
* **security:** clear the code-scanning alerts in tests and patch minimatch in desktop ([e9f57d0](https://github.com/otea-dev/otea/commit/e9f57d098b44cccdf578665025f45e289b42acf8))
* **security:** escape backslashes in the token-budget test's argument quoting ([a29cfc6](https://github.com/otea-dev/otea/commit/a29cfc6867c6bb2dc240711647bedd8fa8f60a6c))
* **test:** keep the test setup from loading the store, so UI tests run on Node 22 ([7f8df0c](https://github.com/otea-dev/otea/commit/7f8df0ccabff06a7765cf92b44393aca8c0efbb9))
* **ui:** close the slot a handed-off row leaves as it folds, and soften the line of light ([5e2c93f](https://github.com/otea-dev/otea/commit/5e2c93f0756e9d66464d8ad78469c88515c83ce7))
* **ui:** darken the light route lines to 3:1 on the page and the sheet ([71e8669](https://github.com/otea-dev/otea/commit/71e8669e5b50ffedb72dfb3fb8c7bf89a243c8dd))
* **ui:** do not open with "nobody is listening" while agents are at work ([08e027e](https://github.com/otea-dev/otea/commit/08e027e45878e7422c4b2ad1da933c6e5d3a491f))
* **ui:** keep Create in sight at the foot of the new-item sheet ([5103977](https://github.com/otea-dev/otea/commit/5103977393cb10ecbfccfeb8dd8f16d29aae6035))
* **ui:** keep the Matrix axis words clear of the docked tray ([93e4254](https://github.com/otea-dev/otea/commit/93e4254589fe4f430c963fcee829f9ebcbbee9ee))
* **ui:** leave where the project lives off the empty-project screen ([a18a6ef](https://github.com/otea-dev/otea/commit/a18a6ef15c6e7523abf04bd23d3985c26f06395f))
* **ui:** the closing bulk tray no longer says "These 0 share no move" ([b14f9b8](https://github.com/otea-dev/otea/commit/b14f9b8287edc53f279cafabf2326b1bc58d1f00))

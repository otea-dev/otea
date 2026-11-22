# Changelog

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

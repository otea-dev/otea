# Changelog

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

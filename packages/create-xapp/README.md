# create-xapp

Scaffold an [XApps](https://github.com/realxhabib/XApps) app in seconds. No dependencies, and no
network needed to scaffold.

```bash
npx create-xapp my-game                          # React + Vite + TypeScript (default)
npx create-xapp my-board --template turn-based   # shared state + turns
npx create-xapp my-page --template vanilla       # one HTML file, no build
```

Then:

```bash
cd my-game
npm install
npm run dev        # opens standalone with the SDK's mock host: you vs a practice bot
```

## Templates

| Template | What you get |
| --- | --- |
| `react` | Vite + React + TypeScript with `@xapps/sdk`: a 1v1 tap race using room messages, `submit`, and a practice bot via `submitFor` |
| `turn-based` | The React setup with tic-tac-toe on the shared match state (`state.update` + `turn.end`), read-only spectators and a practice bot |
| `vanilla` | A single `index.html` importing the SDK bundle from your XApps host (`https://YOUR-XAPPS-HOST/sdk/v1.js`) |

Every template includes an `xapps.manifest.json` (your listing and capabilities: name, tagline,
category, icon, accent, modes, players, teams, spectators, turnBased, scoring, how-to…) and a
README with the path to launch: `npm run dev` → register at `<xapps-host>/developers/new` →
Sandbox → versions → review.

## Options

| Option | |
| --- | --- |
| `-t, --template <name>` | `react` (default), `turn-based` or `vanilla` |
| `-n, --name <title>` | Display name (default: from the folder name, `my-game` → "My Game") |
| `-y, --yes` | No questions, use the defaults |
| `-l, --list` | List the templates |
| `-h, --help` · `-v, --version` | |

Without `--yes`, and when run in a terminal, it asks for anything you left out. The project name
must be a valid npm package name, and the target folder must be empty or not exist.

## Programmatic use

```js
import { scaffold } from "create-xapp";

scaffold({ targetDir: "./my-game", template: "turn-based", name: "My Game" });
```

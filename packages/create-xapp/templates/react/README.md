# {{name}}

An [XApps](https://github.com/realxhabib/XApps) app: a 10-second tap race for two players, built with
Vite, React, TypeScript and [`@xapps/sdk`](https://www.npmjs.com/package/@xapps/sdk).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

Opened directly, the SDK starts a **mock host**: you are seated against a practice bot that this app
plays itself (`submitFor`). The browser console shows what the host sees (`[xapps mock]`) and your
logs (`[xapps log]`). Handy URL switches:

- `?xapps-players=4` seats more bots (the manifest says 2, but the code handles any table).
- `?xapps-role=spectator` shows the read-only spectator view (in the mock nobody plays the bots, so
  use the Sandbox to watch a real race).

Where things are:

| File | What |
| --- | --- |
| `src/main.tsx` | `<XAppsProvider>` connects to the host (or the mock) |
| `src/App.tsx` | The game: `ready()`, `onStart`, `room.send`/`useRoomEvent`, `submit`, `submitFor`, `useLogger` |
| `xapps.manifest.json` | Your listing and capabilities (players, modes, scoring…) |

## Ship it

1. **Deploy** `npm run build` (the `dist/` folder) to any HTTPS static host. Allow XApps to frame it,
   e.g. `Content-Security-Policy: frame-ancestors https://<xapps-host>`.
2. **Register** the app at `https://<xapps-host>/developers/new`. Copy the fields from
   `xapps.manifest.json` (name, tagline, description, category, icon, accent, modes, players,
   scoring, how-to…) and set the URL to your deployment. This creates version `1.0.0`.
3. **Sandbox**: open `https://<xapps-host>/developers/sandbox` to play both seats side by side with
   a live protocol log. Invite **testers** from your app's console so they can play test builds.
4. **Versions**: each change you want players to get is a new version (new URL and/or manifest) on
   the Versions tab of `https://<xapps-host>/developers/apps/{{slug}}`.
5. **Review**: submit the version. Once it's approved you publish it, and players get it.

Your app's console also has **Analytics** and **Logs**: everything you send with
`xapps.log.*` / `useLogger()`, plus uncaught errors (captured automatically).

## Learn more

- SDK reference: the `@xapps/sdk` README (API, shared state, turns, media, stats, achievements, logs).
- Keep scores honest: everything that both players must agree on should come from the shared seed
  (`xapps.random`), and secrets need commit-reveal. For full trust, settle matches from your own
  server with `@xapps/sdk/server`.

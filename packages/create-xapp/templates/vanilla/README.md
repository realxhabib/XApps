# {{name}}

An [XApps](https://github.com/realxhabib/XApps) app in **one HTML file**, no build step: a
10-second tap race for two players.

## Develop

1. In `index.html`, replace `YOUR-XAPPS-HOST` with your XApps host. Every XApps host serves the SDK
   bundle at `/sdk/v1.js` (classic script: `/sdk/v1.global.js` → `window.XApps`).
2. Serve the folder over http(s), not `file://`:

   ```bash
   npx serve .        # or python3 -m http.server
   ```

3. Open the printed URL. Opened directly, the SDK starts a **mock host**: you race a practice bot
   that the page plays itself. The browser console shows what the host sees (`[xapps mock]`) and
   your logs (`[xapps log]`). Try `?xapps-players=4` for more bots.

Prefer npm? `npm i @xapps/sdk` and `import { connect } from "@xapps/sdk"` with any bundler, or run
`npx create-xapp my-game` for the React template.

## Ship it

1. **Deploy** this folder to any HTTPS static host. Allow XApps to frame it, e.g.
   `Content-Security-Policy: frame-ancestors https://<xapps-host>`.
2. **Register** the app at `https://<xapps-host>/developers/new`. Copy the fields from
   `xapps.manifest.json` and set the URL to your deployment. This creates version `1.0.0`.
3. **Sandbox**: `https://<xapps-host>/developers/sandbox` plays both seats side by side with a live
   protocol log. Invite **testers** from your app's console so they can play test builds.
4. **Versions**: every change players should get is a new version on the Versions tab of
   `https://<xapps-host>/developers/apps/{{slug}}`.
5. **Review**: submit the version; once approved, publish it.

Your app's console also has **Analytics** and **Logs** (everything sent with `xapps.log.*`, plus
uncaught errors, captured automatically).

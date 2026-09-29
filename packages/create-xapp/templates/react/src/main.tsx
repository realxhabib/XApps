import { XAppsProvider } from "@xapps/sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <XAppsProvider
      fallback={<p className="center muted">Connecting…</p>}
      errorFallback={(error) => <p className="center">Couldn’t reach XApps: {error.message}</p>}
      // Only used when the page is opened directly (npm run dev): a local mock
      // host seats you against a practice bot (?xapps-players=4 for more bots).
      options={{ mock: { startDelayMs: 800 } }}
    >
      <App />
    </XAppsProvider>
  </StrictMode>,
);

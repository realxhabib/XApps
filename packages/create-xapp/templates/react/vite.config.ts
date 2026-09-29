import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` serves the app on http://localhost:5173. Opened directly, the
// SDK starts its mock host (you vs a practice bot). Inside XApps (the Sandbox
// or a real match) the same build talks to the real host.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative asset paths, so the build works from any folder on your host.
  base: "./",
});

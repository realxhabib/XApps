// Builds the publishable ESM package (dist/*.js + .d.ts) and a drop-in
// browser bundle (dist/xapps.js, dist/xapps.global.js) for no-build apps.
// `@xapps/sdk/server` (dist/server.js) is ESM only.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Paths below are relative to the package, wherever the script is run from.
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
rmSync("dist", { recursive: true, force: true });

const shared = { absWorkingDir: process.cwd(), bundle: true, target: "es2020", sourcemap: true, logLevel: "warning" };

await build({
  ...shared,
  entryPoints: {
    index: "src/index.ts",
    react: "src/react.tsx",
    host: "src/host.ts",
    protocol: "src/protocol.ts",
    // App servers only (webhook verification + server API); never in the browser bundles below.
    server: "src/server.ts",
  },
  outdir: "dist",
  format: "esm",
  splitting: true,
  platform: "neutral",
  external: ["react", "react/jsx-runtime"],
  jsx: "automatic",
});

// Single-file ESM for `import { connect } from "https://host/sdk/v1.js"`.
await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/xapps.js", format: "esm", minify: true });
// Classic <script> tag: exposes `window.XApps`.
await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/xapps.global.js",
  format: "iife",
  globalName: "XApps",
  minify: true,
});

// Type declarations (dist/*.d.ts, next to each entry's JS).
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"], {
  stdio: "inherit",
});
// The sources use extensionless relative imports (bundler resolution). Give the
// emitted declarations explicit `.js` specifiers so they also resolve for
// consumers on `moduleResolution: "node16" | "nodenext"`.
for (const file of readdirSync("dist")) {
  if (!file.endsWith(".d.ts")) continue;
  const path = `dist/${file}`;
  const source = readFileSync(path, "utf8");
  const fixed = source.replace(
    /(from\s+|import\()(["'])(\.\.?\/[^"']+?)\2/g,
    (match, lead, quote, spec) => (/\.(js|mjs|cjs|json)$/.test(spec) ? match : `${lead}${quote}${spec}.js${quote}`),
  );
  if (fixed !== source) writeFileSync(path, fixed);
}
console.log("@xapps/sdk built → dist/");

// Builds @xapps/sdk and publishes the browser bundle at /sdk/v1.js so apps
// hosted anywhere can `import { connect } from "https://<host>/sdk/v1.js"`.
// Also copies the example apps (examples/*) into /examples.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const root = resolve(web, "../..");
const sdk = resolve(root, "packages/sdk");

execFileSync(process.execPath, ["build.mjs"], { cwd: sdk, stdio: "inherit" });

mkdirSync(resolve(web, "public/sdk"), { recursive: true });
cpSync(resolve(sdk, "dist/xapps.js"), resolve(web, "public/sdk/v1.js"));
cpSync(resolve(sdk, "dist/xapps.js.map"), resolve(web, "public/sdk/xapps.js.map"));
cpSync(resolve(sdk, "dist/xapps.global.js"), resolve(web, "public/sdk/v1.global.js"));
cpSync(resolve(sdk, "dist/xapps.global.js.map"), resolve(web, "public/sdk/xapps.global.js.map"));

mkdirSync(resolve(web, "public/examples"), { recursive: true });
cpSync(resolve(root, "examples"), resolve(web, "public/examples"), { recursive: true });
console.log("SDK synced → public/sdk/v1.js, examples → public/examples/");

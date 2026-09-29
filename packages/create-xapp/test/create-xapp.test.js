import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, parseArgs } from "../src/cli.js";
import {
  SDK_RANGE,
  TEMPLATES,
  cleanDisplayName,
  render,
  scaffold,
  titleFromSlug,
  validateName,
} from "../src/index.js";

const pkgDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bin = join(pkgDir, "bin", "create-xapp.js");
const ownVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const sdkVersion = JSON.parse(readFileSync(join(pkgDir, "..", "sdk", "package.json"), "utf8")).version;

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "create-xapp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const read = (...parts) => readFileSync(join(...parts), "utf8");

function listAll(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listAll(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1)]))
    .sort();
}

/** A stdout/stderr stand-in that records what was written. */
function sink() {
  const stream = new PassThrough();
  let text = "";
  stream.on("data", (chunk) => (text += chunk));
  return { stream, text: () => text };
}

describe("names", () => {
  it("accepts npm package names", () => {
    for (const ok of ["my-game", "game2", "a", "my.game", "my_game", "@me/game"]) expect(validateName(ok)).toEqual([]);
  });

  it("rejects what npm rejects", () => {
    expect(validateName("")).not.toEqual([]);
    expect(validateName("My-Game")).toContain("name must be lowercase");
    expect(validateName(".hidden")).toContain("name can't start with a period");
    expect(validateName("_private")).toContain("name can't start with an underscore");
    expect(validateName("node_modules")).not.toEqual([]);
    expect(validateName("has space")).not.toEqual([]);
    expect(validateName("wow!")).not.toEqual([]);
    expect(validateName("a/b")).not.toEqual([]);
    expect(validateName("x".repeat(215))).not.toEqual([]);
  });

  it("derives a display name and keeps it safe to substitute", () => {
    expect(titleFromSlug("my-cool_game")).toBe("My Cool Game");
    expect(cleanDisplayName(' Say "hi" <b>{now}</b> ')).toBe("Say hi bnow/b");
    expect(render("{{name}} / {{ slug }} / {{other}}", { name: "N", slug: "s" })).toBe("N / s / {{other}}");
  });
});

describe("scaffold", () => {
  it("ships the SDK version it was released with", () => {
    expect(ownVersion).toBe(sdkVersion);
    expect(SDK_RANGE).toBe(`^${sdkVersion}`);
  });

  for (const { name: template } of TEMPLATES) {
    it(`writes the ${template} template with substitutions`, () => {
      const target = join(tmp, "tap-race");
      const result = scaffold({ targetDir: target, template, name: "Tap Race" });
      expect(result).toMatchObject({ template, slug: "tap-race", name: "Tap Race" });
      const files = listAll(target);
      expect(files).toEqual(result.files);
      expect(files).toContain("README.md");
      expect(files).toContain("xapps.manifest.json");
      expect(files).toContain("index.html");

      // No placeholder survives anywhere.
      for (const file of files) expect(read(target, file), file).not.toMatch(/\{\{\s*(name|slug|sdkVersion)\s*\}\}/);

      const manifest = JSON.parse(read(target, "xapps.manifest.json"));
      expect(manifest).toMatchObject({ name: "Tap Race", players: { min: 2, max: 2 }, scoring: "high" });
      for (const key of ["tagline", "description", "category", "icon", "accent", "modes", "howTo", "spectators", "turnBased"]) {
        expect(manifest, key).toHaveProperty(key);
      }
      expect(read(target, "README.md")).toMatch(/^# Tap Race/);
      expect(read(target, "README.md")).toContain("/developers/apps/tap-race");
      expect(read(target, "README.md")).toMatch(/developers\/new[\s\S]*Sandbox[\s\S]*Versions[\s\S]*Review/);
      expect(read(target, "index.html")).toContain("<title>Tap Race</title>");

      if (template === "vanilla") {
        expect(files).toEqual(["README.md", "index.html", "xapps.manifest.json"]);
        const html = read(target, "index.html");
        expect(html).toContain('from "https://YOUR-XAPPS-HOST/sdk/v1.js"');
        expect(html).toMatch(/submitFor/);
        expect(manifest.turnBased).toBe(false);
        // The inline module parses.
        const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
        expect(script).toBeTruthy();
        expect(() => transformSync(script, { loader: "js", format: "esm" })).not.toThrow();
      } else {
        expect(files).toEqual(
          expect.arrayContaining([".gitignore", "package.json", "tsconfig.json", "vite.config.ts", "src/main.tsx", "src/App.tsx"]),
        );
        expect(files).not.toContain("_gitignore");
        const pkg = JSON.parse(read(target, "package.json"));
        expect(pkg.name).toBe("tap-race");
        expect(pkg.dependencies["@xapps/sdk"]).toBe(`^${sdkVersion}`);
        expect(pkg.scripts.dev).toBe("vite");
        expect(manifest.turnBased).toBe(template === "turn-based");
        const app = read(target, "src/App.tsx");
        if (template === "react") {
          expect(app).toMatch(/room\.send\("taps"/);
          expect(app).toMatch(/submitFor/);
        } else {
          expect(app).toMatch(/update\(/);
          expect(app).toMatch(/turn\.end\(\)/);
          expect(app).toMatch(/isSpectator/);
          expect(read(target, "src/main.tsx")).toMatch(/turnBased: true/);
        }
        expect(app).toMatch(/useLogger/);
      }
    });
  }

  it("refuses to write into a non-empty folder", () => {
    const target = join(tmp, "busy");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "mine");
    expect(() => scaffold({ targetDir: target })).toThrow(/not empty/);
    expect(read(target, "keep.txt")).toBe("mine");
    expect(listAll(target)).toEqual(["keep.txt"]);
  });

  it("writes into an existing empty folder, and refuses bad names and templates", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    expect(scaffold({ targetDir: empty, template: "vanilla" }).name).toBe("Empty");
    expect(() => scaffold({ targetDir: join(tmp, "Bad Name") })).toThrow(/Invalid project name/);
    expect(() => scaffold({ targetDir: join(tmp, "ok"), template: "svelte" })).toThrow(/Unknown template/);
    expect(existsSync(join(tmp, "ok"))).toBe(false);
  });
});

describe("TypeScript templates parse", () => {
  for (const template of ["react", "turn-based"]) {
    it(`${template}: every .ts/.tsx file transpiles`, () => {
      const target = join(tmp, "app");
      scaffold({ targetDir: target, template });
      const sources = listAll(target).filter((f) => /\.tsx?$/.test(f));
      expect(sources.length).toBeGreaterThanOrEqual(4);
      for (const file of sources) {
        const loader = file.endsWith(".tsx") ? "tsx" : "ts";
        expect(() => transformSync(read(target, file), { loader, jsx: "automatic", format: "esm" }), file).not.toThrow();
      }
    });
  }
});

describe("cli", () => {
  it("parses flags", () => {
    expect(parseArgs(["my-game", "-t", "vanilla", "--yes"])).toMatchObject({ dir: "my-game", template: "vanilla", yes: true });
    expect(parseArgs(["--template=turn-based", "x", "--name", "X Game"])).toMatchObject({ template: "turn-based", dir: "x", name: "X Game" });
    expect(parseArgs(["--list"]).list).toBe(true);
    expect(parseArgs(["--template"]).errors).toEqual(["--template needs a value"]);
    expect(parseArgs(["a", "b", "--wat"]).errors).toEqual(["Unexpected argument b", "Unknown option --wat"]);
  });

  it("scaffolds non-interactively and prints next steps", async () => {
    const out = sink();
    const err = sink();
    const code = await main(["my-game", "--template", "turn-based", "--yes"], { stdout: out.stream, stderr: err.stream, cwd: tmp });
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    expect(out.text()).toMatch(/Created My Game in my-game/);
    expect(out.text()).toMatch(/cd my-game[\s\S]*npm install[\s\S]*npm run dev/);
    expect(out.text()).toContain("/developers/new");
    expect(existsSync(join(tmp, "my-game", "src", "game.ts"))).toBe(true);
  });

  it("asks when interactive (TTY without --yes)", async () => {
    const input = new PassThrough();
    Object.assign(input, { isTTY: true });
    const out = sink();
    const done = main([], { stdin: input, stdout: out.stream, stderr: sink().stream, cwd: tmp });
    input.write("Bad Name\n");   // rejected: not a valid package name
    input.write("quiz-night\n"); // project name
    input.write("3\n");          // template: vanilla
    input.write("Quiz Night!\n"); // display name
    expect(await done).toBe(0);
    expect(out.text()).toMatch(/Project name[\s\S]*Template[\s\S]*Display name/);
    const manifest = JSON.parse(read(tmp, "quiz-night", "xapps.manifest.json"));
    expect(manifest.name).toBe("Quiz Night!");
    expect(listAll(join(tmp, "quiz-night"))).toEqual(["README.md", "index.html", "xapps.manifest.json"]);
  });

  it("fails without a name when not interactive, and on a non-empty folder", async () => {
    const err = sink();
    expect(await main([], { stdin: Object.assign(new PassThrough(), { isTTY: false }), stdout: sink().stream, stderr: err.stream, cwd: tmp })).toBe(1);
    expect(err.text()).toMatch(/Missing the project name/);
    mkdirSync(join(tmp, "taken"));
    writeFileSync(join(tmp, "taken", "x"), "");
    const err2 = sink();
    expect(await main(["taken", "-y"], { stdout: sink().stream, stderr: err2.stream, cwd: tmp })).toBe(1);
    expect(err2.text()).toMatch(/not empty/);
    const err3 = sink();
    expect(await main(["ok", "-t", "nope", "-y"], { stdout: sink().stream, stderr: err3.stream, cwd: tmp })).toBe(1);
    expect(err3.text()).toMatch(/Unknown template/);
  });

  it("runs as a real process: --list, --version, and a scaffold", () => {
    const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: tmp, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    const list = run("--list");
    expect(list.status).toBe(0);
    for (const t of TEMPLATES) expect(list.stdout).toContain(t.name);
    expect(run("--version").stdout.trim()).toBe(ownVersion);
    const made = run("cli-game", "--yes");
    expect(made.status).toBe(0);
    expect(made.stdout).toContain("react template");
    expect(JSON.parse(read(tmp, "cli-game", "package.json")).name).toBe("cli-game");
    const again = run("cli-game", "--yes");
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/not empty/);
  });
});

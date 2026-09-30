// create-xapp: scaffolds an XApps app from the templates shipped in this
// package. Zero dependencies; everything here runs offline.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the templates live (one folder per template). */
export const TEMPLATES_DIR = resolve(here, "..", "templates");

/** @typedef {{ name: string, title: string, description: string }} TemplateInfo */

/** @type {readonly TemplateInfo[]} */
export const TEMPLATES = [
  {
    name: "react",
    title: "React (Vite + TypeScript)",
    description: "A 1v1 tap race: realtime room messages, submit, and a practice bot.",
  },
  {
    name: "turn-based",
    title: "Turn-based (Vite + React + TypeScript)",
    description: "Tic-tac-toe on shared match state + turns, read-only spectators, a practice bot.",
  },
  {
    name: "vanilla",
    title: "Vanilla (one HTML file)",
    description: "No build step: a single index.html importing the SDK bundle from your XApps host.",
  },
];

export const DEFAULT_TEMPLATE = "react";

/** The @xapps/sdk version range new projects depend on (this package is released in lockstep). */
export const SDK_RANGE = `^${readOwnVersion()}`;

function readOwnVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.7.0";
  } catch {
    return "0.7.0";
  }
}

/** Files whose contents get `{{name}}`-style substitution (everything else is copied byte for byte). */
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
]);

/** Template file names that npm would mangle or drop on publish, and their real names. */
const RENAMES = { _gitignore: ".gitignore", "_npmrc": ".npmrc" };

const BLOCKED_NAMES = new Set(["node_modules", "favicon.ico"]);

/**
 * Checks a project name against npm's package name rules. Returns a list of
 * problems (empty when the name is valid).
 * @param {string} name
 * @returns {string[]}
 */
export function validateName(name) {
  const problems = [];
  if (typeof name !== "string" || name.length === 0) return ["name can't be empty"];
  if (name.length > 214) problems.push("name can't be longer than 214 characters");
  if (name.trim() !== name) problems.push("name can't have leading or trailing spaces");
  if (name.startsWith(".")) problems.push("name can't start with a period");
  if (name.startsWith("_")) problems.push("name can't start with an underscore");
  if (name !== name.toLowerCase()) problems.push("name must be lowercase");
  if (BLOCKED_NAMES.has(name)) problems.push(`"${name}" is a reserved name`);
  if (/[~'!()*]/.test(name)) problems.push("name can't contain ~'!()*");
  const scoped = /^@([^/]+)\/([^/]+)$/.exec(name);
  const parts = scoped ? [scoped[1], scoped[2]] : [name];
  if (!scoped && name.includes("/")) problems.push("name can't contain a slash (unless it's @scope/name)");
  for (const part of parts) {
    if (encodeURIComponent(part) !== part) {
      problems.push("name can only contain URL-friendly characters (a-z, 0-9, - . _)");
      break;
    }
  }
  return problems;
}

/** "my-cool_game" → "My Cool Game". */
export function titleFromSlug(slug) {
  const bare = slug.replace(/^@[^/]+\//, "");
  const words = bare.split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return "My XApp";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * A display name that is safe to drop into HTML, JSON and Markdown as is:
 * quotes, backslashes, angle brackets, braces and control characters are
 * removed, and it is capped at 40 characters.
 */
export function cleanDisplayName(name) {
  return String(name)
    .replace(/[\u0000-\u001f"'`\\<>{}$]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}

/** Replaces `{{key}}` placeholders; unknown keys are left alone. */
export function render(text, vars) {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

/** Is `dir` missing or empty? */
export function isEmptyDir(dir) {
  if (!existsSync(dir)) return true;
  if (!statSync(dir).isDirectory()) return false;
  return readdirSync(dir).length === 0;
}

function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out.sort();
}

const extensionOf = (file) => {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

/**
 * Copies a template into `targetDir` with `{{name}}`, `{{slug}}` and
 * `{{sdkVersion}}` filled in. Refuses to write into a non-empty directory.
 *
 * @param {{ targetDir: string, template?: string, name?: string, slug?: string }} options
 * @returns {{ targetDir: string, template: string, slug: string, name: string, files: string[] }}
 */
export function scaffold(options) {
  const template = options.template ?? DEFAULT_TEMPLATE;
  if (!TEMPLATES.some((t) => t.name === template)) {
    throw new Error(`Unknown template "${template}". Available: ${TEMPLATES.map((t) => t.name).join(", ")}`);
  }
  const targetDir = resolve(options.targetDir);
  const slug = options.slug ?? basename(targetDir);
  const problems = validateName(slug);
  if (problems.length) throw new Error(`Invalid project name "${slug}": ${problems.join("; ")}`);
  if (!isEmptyDir(targetDir)) {
    throw new Error(`${targetDir} already exists and is not empty. Pick a new folder name or empty it first.`);
  }
  const name = cleanDisplayName(options.name ?? "") || titleFromSlug(slug);
  const vars = { name, slug, sdkVersion: SDK_RANGE };

  const source = join(TEMPLATES_DIR, template);
  const files = listFiles(source);
  mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const file of files) {
    const parts = file.split(/[\\/]/);
    const last = parts.pop() ?? file;
    const outRel = join(...parts, RENAMES[last] ?? last);
    const outPath = join(targetDir, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    const input = readFileSync(join(source, file));
    const ext = extensionOf(last);
    const isText = TEXT_EXTENSIONS.has(ext) || last in RENAMES;
    writeFileSync(outPath, isText ? render(input.toString("utf8"), vars) : input);
    written.push(outRel.split("\\").join("/"));
  }
  return { targetDir, template, slug, name, files: written.sort() };
}

// Command line front end for create-xapp.
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEMPLATE, TEMPLATES, isEmptyDir, scaffold, titleFromSlug, validateName } from "./index.js";

const HELP = `
Usage: npx create-xapp <project-name> [options]

Scaffolds an XApps app: a ready project using @xapps/sdk, an
xapps.manifest.json and a README with the path to launch.

Options:
  -t, --template <name>  react (default), turn-based or vanilla
  -n, --name <title>     Display name (default: from the project name)
  -y, --yes              Skip the questions and use the defaults
  -l, --list             List the templates
  -v, --version          Print the version
  -h, --help             Show this help

Examples:
  npx create-xapp my-game
  npx create-xapp my-board --template turn-based
  npx create-xapp my-page -t vanilla --yes
`;

const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor() ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const cyan = paint("36");
const red = paint("31");

function version() {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    return String(pkg.version);
  } catch {
    return "unknown";
  }
}

/**
 * @param {string[]} argv
 * @returns {{ dir?: string, template?: string, name?: string, yes: boolean, list: boolean, help: boolean, version: boolean, errors: string[] }}
 */
export function parseArgs(argv) {
  const out = { yes: false, list: false, help: false, version: false, errors: /** @type {string[]} */ ([]) };
  /** @type {string | undefined} */ let dir;
  /** @type {string | undefined} */ let template;
  /** @type {string | undefined} */ let name;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        out.errors.push(`${flag} needs a value`);
        return undefined;
      }
      i++;
      return next;
    };
    switch (flag) {
      case "-t":
      case "--template":
        template = value();
        break;
      case "-n":
      case "--name":
        name = value();
        break;
      case "-y":
      case "--yes":
        out.yes = true;
        break;
      case "-l":
      case "--list":
        out.list = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      default:
        if (arg.startsWith("-")) out.errors.push(`Unknown option ${arg}`);
        else if (dir === undefined) dir = arg;
        else out.errors.push(`Unexpected argument ${arg}`);
    }
  }
  return { ...out, dir, template, name };
}

/** Minimal line prompt on node:readline. */
function createPrompter(input, output) {
  const rl = createInterface({ input, output });
  /** @type {string[]} */
  const queued = [];
  /** @type {((line: string | null) => void)[]} */
  const waiting = [];
  let closed = false;
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()?.(null);
  });
  return {
    /** @returns {Promise<string | null>} null when input closed (Ctrl+D) */
    ask(question) {
      output.write(question);
      if (queued.length) return Promise.resolve(queued.shift() ?? "");
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

function printTemplates(out) {
  out.write(`\n${bold("Templates")}\n`);
  for (const t of TEMPLATES) {
    const tag = t.name === DEFAULT_TEMPLATE ? dim(" (default)") : "";
    out.write(`  ${cyan(t.name.padEnd(11))} ${t.title}${tag}\n  ${" ".repeat(11)} ${dim(t.description)}\n`);
  }
  out.write("\n");
}

class Cancelled extends Error {}

/**
 * Runs the CLI. Returns the process exit code.
 * @param {string[]} argv
 * @param {{ stdin?: NodeJS.ReadableStream & { isTTY?: boolean }, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, cwd?: string }} [io]
 */
export async function main(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const args = parseArgs(argv);
  const fail = (message) => {
    stderr.write(`${red("✖")} ${message}\n`);
    return 1;
  };

  if (args.errors.length) return fail(`${args.errors.join("\n  ")}\n${HELP}`);
  if (args.help) {
    stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    stdout.write(`${version()}\n`);
    return 0;
  }
  if (args.list) {
    printTemplates(stdout);
    return 0;
  }
  if (args.template !== undefined && !TEMPLATES.some((t) => t.name === args.template)) {
    return fail(`Unknown template "${args.template}". Run with --list to see them.`);
  }

  const interactive = !args.yes && Boolean(stdin.isTTY);
  const prompter = interactive ? createPrompter(stdin, stdout) : null;
  try {
    const ask = async (question) => {
      const answer = await /** @type {NonNullable<typeof prompter>} */ (prompter).ask(question);
      if (answer === null) throw new Cancelled();
      return answer.trim();
    };

    let dir = args.dir;
    if (!dir) {
      if (!prompter) return fail(`Missing the project name, e.g. ${cyan("npx create-xapp my-game")}`);
      while (!dir) {
        const answer = (await ask(`${bold("Project name")} ${dim("(my-xapp)")}: `)) || "my-xapp";
        const problems = validateName(basename(answer));
        if (problems.length) stderr.write(`  ${red(problems.join("; "))}\n`);
        else dir = answer;
      }
    }

    const targetDir = resolve(cwd, dir);
    const slug = basename(targetDir);
    const problems = validateName(slug);
    if (problems.length) return fail(`"${slug}" is not a valid package name: ${problems.join("; ")}`);
    if (!isEmptyDir(targetDir)) {
      return fail(`${relative(cwd, targetDir) || "."} is not empty. Pick another name or empty the folder first.`);
    }

    let template = args.template;
    if (!template && prompter) {
      stdout.write(`${bold("Template")}\n`);
      TEMPLATES.forEach((t, i) => stdout.write(`  ${cyan(String(i + 1))}. ${t.title} ${dim(`— ${t.description}`)}\n`));
      while (!template) {
        const answer = (await ask(`Pick 1-${TEMPLATES.length} ${dim("(1)")}: `)) || "1";
        const byNumber = TEMPLATES[Number(answer) - 1];
        const byName = TEMPLATES.find((t) => t.name === answer);
        template = (byNumber ?? byName)?.name;
        if (!template) stderr.write(`  ${red("Type a number or a template name.")}\n`);
      }
    }
    template ??= DEFAULT_TEMPLATE;

    let name = args.name;
    if (name === undefined && prompter) {
      const fallback = titleFromSlug(slug);
      name = (await ask(`${bold("Display name")} ${dim(`(${fallback})`)}: `)) || fallback;
    }

    const result = scaffold({ targetDir, template, name, slug });
    const where = relative(cwd, result.targetDir) || ".";
    const isVanilla = template === "vanilla";

    stdout.write(`\n${green("✔")} Created ${bold(result.name)} in ${cyan(where)} ${dim(`(${template} template, ${result.files.length} files)`)}\n\n`);
    stdout.write(`${bold("Next steps")}\n`);
    const steps = [];
    if (where !== ".") steps.push(`cd ${where.includes(" ") ? JSON.stringify(where) : where}`);
    if (isVanilla) {
      steps.push("npx serve .            # or any static server; then open the printed URL");
    } else {
      steps.push("npm install");
      steps.push("npm run dev            # plays standalone against a bot (mock host)");
    }
    steps.forEach((s, i) => stdout.write(`  ${dim(`${i + 1}.`)} ${cyan(s)}\n`));
    stdout.write(
      `\n${bold("Ship it")}\n` +
        `  1. Deploy it anywhere that serves HTTPS and allows framing by your XApps host\n` +
        `  2. Register it at ${cyan("<xapps-host>/developers/new")} (fields from ${cyan("xapps.manifest.json")})\n` +
        `  3. Play both seats in the ${cyan("Sandbox")}, invite testers, add versions\n` +
        `  4. Submit a version for review\n\n` +
        `${dim("Docs: README.md in your project and https://www.npmjs.com/package/@xapps/sdk")}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof Cancelled) {
      stderr.write(`\n${dim("Cancelled.")}\n`);
      return 130;
    }
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    prompter?.close();
  }
}

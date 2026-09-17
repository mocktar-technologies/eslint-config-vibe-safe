/**
 * Installs this package the way a user would and lints real files with it.
 *
 * test/mutations.mjs imports ../index.js directly, which proves the rules work but not
 * that the package works. A config can pass every rule test and still be broken as a
 * dependency: the wrong `main`, a file missing from `files`, an export shape that
 * survives `require` but not `import`, globs that only resolve relative to its own
 * repository. This packs the tarball, installs it into a throwaway project, and runs
 * the real eslint binary over files on disk.
 *
 * It checks both module systems, because a CommonJS package consumed from an ESM
 * eslint.config.mjs relies on Node's interop giving the default export, and that is
 * worth proving rather than assuming.
 *
 * Run: npm run test:packaged
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PKG_ROOT = path.resolve(import.meta.dirname, "..");

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok        ${label}`);
  } else {
    failures.push(detail ? `${label}\n      ${detail}` : label);
    console.log(`  FAILED    ${label}`);
  }
}

/**
 * Run a command portably.
 *
 * On Windows `npm` and `npx` are `npm.cmd` and `npx.cmd`, and execFileSync without a
 * shell cannot resolve either: it fails with `spawnSync npm ENOENT`. Node also refuses
 * to spawn a .cmd file directly without a shell, so naming npm.cmd is not a fix.
 *
 * Running through the shell solves that and introduces the next problem: the shell
 * splits on spaces, and one of the arguments here is a path to the packed tarball,
 * which on a real machine is quite likely to sit under a directory whose name contains
 * a space. So every argument is quoted on Windows.
 */
const IS_WINDOWS = process.platform === "win32";

function run(command, args, cwd) {
  const finalArgs = IS_WINDOWS ? args.map((a) => (/[\s&|<>^()]/.test(a) ? `"${a}"` : a)) : args;
  return execFileSync(command, finalArgs, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    shell: IS_WINDOWS,
  });
}

/** Run eslint in the fixture and return its JSON results, whatever the exit code. */
function lintFixture(dir) {
  try {
    const out = run("npx", ["eslint", ".", "--format", "json"], dir);
    return JSON.parse(out);
  } catch (error) {
    /* eslint exits non-zero when it finds errors, which is the normal case here. */
    const out = error.stdout || "";
    const start = out.indexOf("[");
    if (start < 0) {
      throw new Error(`eslint produced no JSON. stdout: ${out}\nstderr: ${error.stderr || ""}`);
    }
    return JSON.parse(out.slice(start));
  }
}

function rulesReported(results) {
  const ids = new Set();
  for (const file of results) {
    for (const message of file.messages) {
      if (message.fatal) {
        throw new Error(`${file.filePath} did not parse: ${message.message}`);
      }
      if (message.ruleId) ids.add(message.ruleId);
    }
  }
  return ids;
}

/* --------------------------------------------------------------- pack the thing */

console.log("\nPacking");

const packed = run("npm", ["pack", "--silent"], PKG_ROOT).trim().split("\n").pop().trim();
const tarball = path.join(PKG_ROOT, packed);
check(`packed ${packed}`, packed.endsWith(".tgz"), `got ${packed}`);

const work = mkdtempSync(path.join(tmpdir(), "vibe-safe-consumer-"));

/* ---------------------------------------------------------- build two consumers */

/**
 * @param {string} name folder name
 * @param {"esm"|"cjs"} flavour which module system the eslint config uses
 */
function buildConsumer(name, flavour) {
  const dir = path.join(work, name);
  mkdirSync(path.join(dir, "src"), { recursive: true });

  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: `consumer-${name}`,
        version: "1.0.0",
        private: true,
        type: flavour === "esm" ? "module" : "commonjs",
      },
      null,
      2,
    ),
  );

  if (flavour === "esm") {
    writeFileSync(
      path.join(dir, "eslint.config.mjs"),
      `import vibeSafe from "eslint-config-vibe-safe";

export default [
  { languageOptions: { globals: { setTimeout: "readonly" } } },
  ...vibeSafe.recommended,
];
`,
    );
  } else {
    writeFileSync(
      path.join(dir, "eslint.config.cjs"),
      `const vibeSafe = require("eslint-config-vibe-safe");

module.exports = [
  { languageOptions: { globals: { setTimeout: "readonly" } } },
  ...vibeSafe.recommended,
];
`,
    );
  }

  /* One file per mistake, so a missing rule points at a named file. */
  writeFileSync(
    path.join(dir, "src", "session.js"),
    `export async function who(supabase) {
  const auth = supabase.auth;
  const { data } = await auth.getSession();
  return data.session;
}
`,
  );
  writeFileSync(
    path.join(dir, "src", "config.js"),
    `const { env } = process;
export const url = env.NEXT_PUBLIC_SUPABASE_URL;
`,
  );
  writeFileSync(
    path.join(dir, "src", "dynamic.js"),
    `export function go(src) {
  return eval(src);
}
`,
  );
  /* And one file that must stay clean. */
  writeFileSync(
    path.join(dir, "src", "correct.js"),
    `import { env } from "./env.js";

export async function who(supabase) {
  const { data } = await supabase.auth.getUser();
  return { user: data.user, url: env.NEXT_PUBLIC_SUPABASE_URL };
}
`,
  );

  return dir;
}

console.log("\nInstalling into a clean project and linting real files");

for (const flavour of ["esm", "cjs"]) {
  const dir = buildConsumer(flavour, flavour);
  run("npm", ["install", "--no-audit", "--no-fund", "--silent", tarball, "eslint@^10.10.0"], dir);

  const installed = readdirSync(path.join(dir, "node_modules", "eslint-config-vibe-safe"));
  check(
    `${flavour}: the installed package carries only what it should`,
    installed.length === 4 &&
      ["LICENSE", "README.md", "index.js", "package.json"].every((f) => installed.includes(f)),
    `installed files: ${installed.join(", ")}`,
  );

  const results = lintFixture(dir);
  const reported = rulesReported(results);

  check(
    `${flavour}: the session ban fires on an installed copy`,
    reported.has("no-restricted-syntax"),
    `rules reported: ${[...reported].join(", ") || "none"}`,
  );
  check(`${flavour}: the execution ban fires`, reported.has("no-eval"));

  const byFile = new Map(results.map((r) => [path.basename(r.filePath), r.messages]));
  check(
    `${flavour}: the renamed auth const is caught in src/session.js`,
    (byFile.get("session.js") || []).some((m) => m.ruleId === "no-restricted-syntax"),
  );
  check(
    `${flavour}: the destructured process is caught in src/config.js`,
    (byFile.get("config.js") || []).some((m) => m.ruleId === "no-restricted-syntax"),
  );
  check(
    `${flavour}: correct code is left alone in src/correct.js`,
    (byFile.get("correct.js") || []).length === 0,
    `reported: ${JSON.stringify(byFile.get("correct.js") || [])}`,
  );
  check(
    `${flavour}: the eslint config file itself lints clean`,
    results.every((r) => !path.basename(r.filePath).startsWith("eslint.config") || r.messages.length === 0),
  );
}

/* ------------------------------------------------------------------- tidy up */

rmSync(work, { recursive: true, force: true });
rmSync(tarball, { force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nProblems:\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nThe rules can pass their own tests and still be broken as a dependency. Fix this before publishing.",
  );
  process.exit(1);
}
console.log("The package works when installed, from both an ESM and a CommonJS config.");

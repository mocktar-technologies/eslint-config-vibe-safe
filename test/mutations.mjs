/**
 * Mutation tests for eslint-config-vibe-safe.
 *
 * Each rule in this package exists to catch one mistake. This suite writes that
 * mistake and fails if the rule stays quiet. It also writes the defensible version of
 * the same code and fails if the rule fires on it, because a config that cries wolf
 * gets switched off and then protects nothing.
 *
 * The suite exists because the rules it tests were once broken in a way reading could
 * not reveal. Each selector matched exactly one syntactic shape, so renaming a
 * variable walked past it:
 *
 *     const auth = supabase.auth;  auth.getSession();   // was not caught
 *     supabase.auth["getSession"]();                     // was not caught
 *     const { env } = process;     env.SOME_VAR;         // was not caught
 *
 * Run: npm test
 */

import { ESLint } from "eslint";
import vibeSafe from "../index.js";

let passed = 0;
const failures = [];

/**
 * A realistic consumer declares its globals. no-implied-eval only reports a string
 * passed to setTimeout when it can resolve setTimeout to the global, so a config with
 * no globals declared leaves that rule inert. Most projects get this from the
 * `globals` package; here the two needed are declared inline to keep this package
 * dependency free.
 */
const consumerEnvironment = {
  files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  languageOptions: {
    globals: { setTimeout: "readonly", setInterval: "readonly" },
  },
};

/** Lint one snippet against a config and return its messages. */
async function lint(code, config, filePath = "src/mutant.js") {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [consumerEnvironment, ...config],
  });
  const [result] = await eslint.lintText(code, { filePath });
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal) {
    /* A snippet that does not parse proves nothing either way, and silently reads as a
       missed rule. Fail loudly instead. */
    throw new Error(`the test snippet did not parse: ${fatal.message}`);
  }
  return result.messages.map((m) => ({
    ruleId: m.ruleId,
    severity: m.severity,
    text: m.message,
  }));
}

/** The mistake must be reported. */
async function fires(label, code, expectedRuleId, config = vibeSafe.recommended, filePath) {
  const messages = await lint(code, config, filePath);
  const hit = messages.find((m) => m.ruleId === expectedRuleId);
  if (hit) {
    passed += 1;
    console.log(`  caught   ${label}`);
  } else {
    failures.push(
      `${label}\n      expected ${expectedRuleId}, got ${
        messages.length ? messages.map((m) => m.ruleId).join(", ") : "nothing"
      }`,
    );
    console.log(`  MISSED   ${label}`);
  }
}

/** The defensible version must be left alone. */
async function quiet(label, code, config = vibeSafe.recommended, filePath) {
  const messages = await lint(code, config, filePath);
  if (messages.length === 0) {
    passed += 1;
    console.log(`  quiet    ${label}`);
  } else {
    failures.push(
      `false positive on ${label}\n      reported ${messages
        .map((m) => `${m.ruleId}: ${m.text}`)
        .join(" | ")}`,
    );
    console.log(`  FALSE +  ${label}`);
  }
}

/* -------------------------------------------------------- unverified sessions */

console.log("\nUnverified sessions");

await fires(
  "getSession, the canonical form",
  `export async function who(supabase) {
  const { data } = await supabase.auth.getSession();
  return data.session;
}`,
  "no-restricted-syntax",
);

await fires(
  "getSession, via a destructured auth const",
  `export async function who(supabase) {
  const auth = supabase.auth;
  const { data } = await auth.getSession();
  return data.session;
}`,
  "no-restricted-syntax",
);

await fires(
  "getSession, via bracket notation",
  `export async function who(supabase) {
  const { data } = await supabase.auth["getSession"]();
  return data.session;
}`,
  "no-restricted-syntax",
);

await fires(
  "getSession, via optional chaining",
  `export async function who(supabase) {
  const result = await supabase.auth?.getSession();
  return result.data.session;
}`,
  "no-restricted-syntax",
);

await quiet(
  "getUser, which is the call you are supposed to make",
  `export async function who(supabase) {
  const { data } = await supabase.auth.getUser();
  return data.user;
}`,
);

/* This one matters for anyone using an auth library that exports a bare getSession().
   The selector requires a member expression, so a bare call is not matched. If that
   ever changes, this test is how you find out before your users do. */
await quiet(
  "a bare getSession() imported from another library",
  `import { getSession } from "some-auth-library";
export async function who() {
  return await getSession();
}`,
);

await quiet(
  "a differently named method that merely starts the same way",
  `export async function count(sessions) {
  return await sessions.getSessionCount();
}`,
);

/* -------------------------------------------------- unvalidated configuration */

console.log("\nUnvalidated configuration");

await fires(
  "process.env, read directly",
  `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
);

await fires(
  "process.env, via bracket notation",
  `export const url = process["env"].NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
);

await fires(
  "process, destructured",
  `const { env } = process;
export const url = env.NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
);

await fires(
  "process, aliased to a local const",
  `const p = process;
export const url = p.env.NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
);

await quiet(
  "a validated env object, which is the pattern this rule pushes you to",
  `import { env } from "./env.js";
export const url = env.NEXT_PUBLIC_SUPABASE_URL;`,
);

await quiet(
  "a variable whose name merely begins with process",
  `const processed = { ready: true };
export const flag = processed.ready;`,
);

await quiet(
  "a property called process on somebody else's object",
  `export function pid(runner) {
  return runner.process.pid;
}`,
);

/* ------------------------------------------------------------ executing strings */

console.log("\nExecuting strings");

await fires("eval", `export function go(src) { return eval(src); }`, "no-eval");

await fires(
  "the Function constructor",
  `export function go(src) { return new Function(src); }`,
  "no-new-func",
);

await fires(
  "a string passed to setTimeout",
  `export function go() { setTimeout("doThing()", 0); }`,
  "no-implied-eval",
);

await fires(
  "a javascript: URL",
  `export function go(el) { el.href = "javascript:alert(1)"; }`,
  "no-script-url",
);

await quiet(
  "an ordinary callback passed to setTimeout",
  `export function go(fn) { setTimeout(fn, 0); }`,
);

/* ------------------------------------------------------- the overriding trap */

console.log("\nThe overriding trap, which the README warns about");

/* Flat config merges blocks in order, and a later block that names the same rule
   replaces its whole option list rather than adding to it. So a consumer who declares
   their own no-restricted-syntax after spreading this config silently deletes every
   ban in it. The README says so; this proves it, so the warning cannot quietly become
   false. */
const overridden = [
  ...vibeSafe.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "DebuggerStatement", message: "no debugger" }],
    },
  },
];

await quiet(
  "re-declaring no-restricted-syntax does wipe the bans, exactly as documented",
  `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
  overridden,
);

/* And the documented fix: concatenate the selectors instead of replacing them. */
const composed = [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vibeSafe.selectors.all,
        { selector: "DebuggerStatement", message: "no debugger" },
      ],
      ...vibeSafe.rules.execution,
    },
  },
];

await fires(
  "concatenating the exported selectors keeps them working",
  `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
  composed,
);

await fires(
  "and the consumer's own selector works alongside them",
  `export function go() { debugger; return 1; }`,
  "no-restricted-syntax",
  composed,
);

/* ---------------------------------------------------------- the env allowlist */

console.log("\nThe env allowlist");

const allowlisted = vibeSafe.withEnvAllowlist(["**/env.js", "**/env.server.js"]);

await quiet(
  "the one module allowed to read process.env can read it",
  `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
  allowlisted,
  "src/lib/env.js",
);

await fires(
  "but any other module still cannot",
  `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
  "no-restricted-syntax",
  allowlisted,
  "src/app/page.js",
);

/* The allowlist must not become a hole for the auth rule too. This is the probe that
   would have caught it if withEnvAllowlist had simply switched the rule off. */
await fires(
  "and the allowlisted module still cannot call getSession",
  `export async function who(supabase) {
  const { data } = await supabase.auth.getSession();
  return data.session;
}`,
  "no-restricted-syntax",
  allowlisted,
  "src/lib/env.js",
);

/* ------------------------------------------------------------ shape of exports */

console.log("\nExported shape");

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok       ${label}`);
  } else {
    failures.push(label);
    console.log(`  BAD      ${label}`);
  }
}

check("recommended is a flat config array", Array.isArray(vibeSafe.recommended));
check("every block in it is named", vibeSafe.recommended.every((b) => typeof b.name === "string"));
check("five selectors are exported", vibeSafe.selectors.all.length === 5);
check(
  "every selector carries a message that says what to do instead",
  vibeSafe.selectors.all.every((s) => typeof s.message === "string" && s.message.length > 40),
);
check(
  "the type-aware rules are exported but not applied",
  Object.keys(vibeSafe.typescriptRules).length === 6 &&
    !JSON.stringify(vibeSafe.recommended).includes("@typescript-eslint"),
);
check(
  "withEnvAllowlist accepts a single string as well as an array",
  vibeSafe.withEnvAllowlist("**/env.js").length === 2,
);

/* --------------------------------------------------------------------- report */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nProblems:\n");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Every rule fires on the mistake and stays quiet on the correct version.");

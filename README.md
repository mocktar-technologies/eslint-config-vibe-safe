# eslint-config-vibe-safe

[![npm](https://img.shields.io/npm/v/eslint-config-vibe-safe)](https://www.npmjs.com/package/eslint-config-vibe-safe)

ESLint rules for the mistakes AI coding assistants make in Next.js and Supabase
applications. Everything here catches code that is syntactically valid, passes a type
check, and is still wrong.

Zero dependencies. Every rule is either a core ESLint rule or a `no-restricted-syntax`
selector, so there is no plugin to install, no peer version to conflict with, and
nothing to keep in step when your toolchain moves.

```bash
npm install --save-dev eslint-config-vibe-safe
```

```js
// eslint.config.js
import vibeSafe from "eslint-config-vibe-safe";

export default [
  ...vibeSafe.recommended,
];
```

## What it catches

**An unverified session used as an authorization decision.** `getSession()` reads
whatever is in the cookie and trusts it. It never asks the auth server whether that
token is still valid, so a stale, revoked or forged cookie satisfies it. `getUser()`
makes the round trip. This is the single most common authorization bug in generated
Supabase code, because `getSession()` is faster and reads more naturally, so it is what
an assistant reaches for first.

**Configuration read straight from `process.env`.** A missing or malformed variable then
fails deep inside a request, in production, months later, instead of at boot. Validate
the environment once in one module and import the parsed object everywhere else.

**Strings executed as code.** `eval`, the `Function` constructor, a string handed to
`setTimeout`, a `javascript:` URL. Generated code reaches for these when it is asked to
be dynamic, and each one turns data into code.

## Each ban covers more than one spelling, on purpose

An AST selector matches a syntactic shape, not a meaning, so a single selector is one
rename away from being decoration. Every one of these was slipping through an earlier
version of these rules:

```js
const auth = supabase.auth;  await auth.getSession();  // caught
await supabase.auth["getSession"]();                    // caught
await supabase.auth?.getSession();                      // caught
const { env } = process;  env.SOME_VAR;                 // caught
const p = process;        p.env.SOME_VAR;               // caught
process["env"].SOME_VAR;                                // caught
```

They were found by writing the renamed version and watching the rule stay silent.
`npm test` in this repository does exactly that for every rule, and also asserts the
opposite where it matters, because a config that fires on correct code gets switched off
and then protects nothing. These all stay quiet:

```js
await supabase.auth.getUser();          // the call you are supposed to make
import { getSession } from "next-auth"; // a bare call, not a member call
await getSession();
import { env } from "./env.js";         // the pattern the rule pushes you toward
env.SOME_VAR;
runner.process.pid;                     // somebody else's property named process
```

## The one way to silently disable all of this

Flat config merges blocks in order, and a later block naming the same rule **replaces
its whole option list** rather than adding to it. So this deletes every ban in the
package, with no error and no warning:

```js
export default [
  ...vibeSafe.recommended,
  {
    rules: {
      // This wipes all five selectors above.
      "no-restricted-syntax": ["error", { selector: "DebuggerStatement", message: "no" }],
    },
  },
];
```

If you have your own selectors, concatenate instead:

```js
export default [
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vibeSafe.selectors.all,
        { selector: "DebuggerStatement", message: "no debugger in committed code" },
      ],
      ...vibeSafe.rules.execution,
    },
  },
];
```

The test suite covers both of these, so the warning above cannot quietly stop being
true.

## Letting one module read process.env

Something has to read it. Pass the paths that are allowed to:

```js
export default [
  ...vibeSafe.withEnvAllowlist(["**/env.ts", "**/env.server.ts"]),
];
```

Those files lose the `process.env` ban and keep everything else, including the session
ban. There is a test for that last part specifically, because an allowlist that
switched the whole rule off would be an easy mistake to ship.

## Type-aware rules, opt in

Four of the ways an assistant silences a type error rather than fixing it, plus the two
async mistakes that fail silently at run time. These need typescript-eslint registered
and configured with type information, which is why they are not in `recommended` and
why this package does not depend on it.

```js
import tseslint from "typescript-eslint";
import vibeSafe from "eslint-config-vibe-safe";

export default [
  ...vibeSafe.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...vibeSafe.typescriptRules,
    },
  },
];
```

## Two caveats worth knowing

**`no-implied-eval` needs your globals declared.** It only reports a string passed to
`setTimeout` when it can resolve `setTimeout` to the global. If your config declares no
globals, that rule is inert. Most projects get this from the `globals` package.

**The session ban is broader than Supabase.** It flags any call to a member named
`getSession`, on any object, because scoping it to `supabase.auth` was exactly the
mistake that let a rename through. A bare `getSession()` is not matched, so libraries
exporting it as a plain function are unaffected. If a library genuinely needs
`client.getSession()`, disable it on that line with a comment saying why.

## What is deliberately not here

A check on `dangerouslySetInnerHTML`, and a check for mass assignment through a spread
into `.insert()`. Both are real problems and both need a human to decide whether the
specific case is safe. `no-restricted-syntax` gives every selector the same severity, so
neither could be a warning, and a linter that errors on a correctly sanitized markdown
renderer teaches you to switch it off. They belong on a review checklist, not in a
config.

Nothing here replaces reviewing the code. These rules remove one category of mistake
mechanically so that the review can spend its attention on the parts a linter cannot
reach: whether your row level security policies actually cover the new table, whether
an external call handles a timeout, whether the model can trigger a side effect nobody
approved.

## Exports

| Export | What it is |
|---|---|
| `recommended` | Flat config array. The five selectors plus the execution rules. |
| `withEnvAllowlist(paths)` | Flat config array, with `process.env` permitted in those paths. |
| `selectors.auth` | The session selectors, for composing your own rule. |
| `selectors.config` | The `process` selectors. |
| `selectors.all` | Both, merged. |
| `rules.execution` | The core rules for executing strings. |
| `typescriptRules` | The type-aware rules, for a block that has typescript-eslint. |

## Requirements

ESLint 9 or later, Node 20.9 or later. Works with any parser: the selectors are plain
ESTree, so they apply to JavaScript and TypeScript alike.

## Licence

MIT.

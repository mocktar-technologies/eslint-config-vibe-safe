/**
 * eslint-config-vibe-safe
 *
 * ESLint rules for the mistakes AI coding assistants make in Next.js and Supabase
 * applications. Every rule here catches something that is syntactically valid, passes
 * a type check, and is still wrong.
 *
 * Zero dependencies on purpose. Everything below is a core ESLint rule or a
 * `no-restricted-syntax` selector, so this package installs in a second, has no peer
 * version to conflict with, and works in any ESLint 9 or 10 flat config. The optional
 * type-aware rules are exported as a plain rules object for you to layer onto your own
 * typescript-eslint setup rather than bundling one here.
 *
 * Deliberately NOT included: a check on `dangerouslySetInnerHTML`, and a check for
 * mass assignment through a spread into `.insert()`. Both need a human to decide
 * whether the specific case is safe, `no-restricted-syntax` gives every selector the
 * same severity so neither could be a warning, and a linter that errors on a correctly
 * sanitized markdown renderer teaches you to switch it off. Those stay manual review
 * items. A check that guesses is a check that will be wrong in public.
 */

"use strict";

/* ---------------------------------------------------------------- selectors */

/**
 * supabase.auth.getSession() reads whatever is in the cookie and trusts it. It does
 * not ask the auth server whether the token is still valid, so a stale, revoked or
 * forged cookie satisfies it. getUser() makes that round trip.
 *
 * Both spellings are banned because an AST selector matches a syntactic shape rather
 * than a meaning, and one shape is one rename away from being useless. The first
 * selector covers `supabase.auth.getSession()`, `auth.getSession()` after a
 * destructure, and `client.getSession()`. The second covers the computed-key form,
 * which is the shortest way around the first.
 *
 * Note what this does NOT match: a bare `getSession()` call, as exported by some auth
 * libraries, because the selector requires a member expression. That is intentional,
 * and test/mutations.mjs pins it.
 */
const authSelectors = [
  {
    selector: "CallExpression[callee.property.name='getSession']",
    message:
      "Do not use getSession() to decide whether someone is authenticated. It reads an unverified cookie. Call getUser() and gate on its result, behind one wrapper that every route uses.",
  },
  {
    selector: "CallExpression[callee.computed=true][callee.property.value='getSession']",
    message:
      "Do not reach getSession() through a computed key. It reads an unverified cookie. Call getUser() and gate on its result.",
  },
];

/**
 * Reading process.env directly means a missing or malformed variable fails somewhere
 * deep in a request, months later, instead of at boot. Validate the environment once,
 * in one module, and import the parsed object everywhere else.
 *
 * The third selector bans aliasing `process` at all, which is what covers both
 * `const { env } = process` and `const p = process`. Without it the two selectors
 * above are decoration.
 */
const configSelectors = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      "Do not read process.env directly. Validate the environment once in a single module and import the parsed, typed object, so a missing variable fails at boot rather than mid request.",
  },
  {
    selector: "MemberExpression[computed=true][object.name='process'][property.value='env']",
    message:
      "Do not read process['env'] directly. Import your validated environment object instead.",
  },
  {
    selector: "VariableDeclarator[init.name='process']",
    message:
      "Do not alias or destructure `process`. That is how code reaches process.env without the other rules seeing it. Import your validated environment object instead.",
  },
];

/* Every selector, merged. `no-restricted-syntax` takes one list, so a consumer who
   wants to add their own selectors must concatenate rather than declare the rule
   twice. See the note on overriding in the README. */
const allSelectors = [...authSelectors, ...configSelectors];

/* ------------------------------------------------------------------- presets */

/**
 * Core ESLint rules for the ways generated code executes a string. All unambiguous,
 * all zero dependency.
 */
const executionRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
};

/**
 * Type-aware rules, exported separately because they need typescript-eslint
 * registered and configured with type information by you. Spread this into a config
 * block of your own that already has the plugin.
 *
 * These are the four ways an assistant silences a type error rather than fixing it,
 * plus the two async mistakes that fail silently at run time.
 */
const typescriptRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-unnecessary-condition": "warn",
};

/** The files these rules are worth applying to. */
const FILES = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];

/**
 * The recommended config. A flat config array, so it drops straight into
 * eslint.config.js with a spread.
 */
const recommended = [
  {
    name: "vibe-safe/recommended",
    files: FILES,
    rules: {
      "no-restricted-syntax": ["error", ...allSelectors],
      ...executionRules,
    },
  },
];

/**
 * The same rules, minus the places they should not apply. Your environment module is
 * the one file that has to read process.env, and your tests need to set it.
 *
 * Pass the paths that are allowed to touch process.env. Everything else keeps the
 * full rule set.
 */
function withEnvAllowlist(paths) {
  const allowed = Array.isArray(paths) ? paths : [paths];
  return [
    ...recommended,
    {
      name: "vibe-safe/env-allowlist",
      files: allowed,
      rules: {
        /* Re-declaring the rule replaces its whole option list, which is exactly the
           trap described in the README. Here it is deliberate: these files keep the
           auth ban and lose only the process.env ban. */
        "no-restricted-syntax": ["error", ...authSelectors],
      },
    },
  ];
}

module.exports = {
  recommended,
  withEnvAllowlist,
  typescriptRules,
  selectors: {
    auth: authSelectors,
    config: configSelectors,
    all: allSelectors,
  },
  rules: {
    execution: executionRules,
  },
};

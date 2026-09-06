import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Conformance tests over every API route, not over one route's behaviour.
 *
 * Broken access control is the flaw this codebase is most exposed to: 108
 * routes, one shared database, and every customer's LinkedIn credentials and
 * leads in it. The failure is never a subtle algorithm, it is a route that
 * looks up a record by the id in the URL and forgets to also ask whose record
 * it is. Reading someone else's data then costs an attacker one changed digit.
 *
 * A per-route integration test would need a database, a session and a fixture
 * for each of the 108. These tests instead read the route files and assert two
 * structural properties across all of them at once. That trades depth for
 * completeness deliberately: they cannot prove a route is correct, but no
 * route can be added without an answer to either question, which is the
 * property that actually decays as a codebase grows.
 */

const API_DIR = path.join(process.cwd(), "src/app/api");

/**
 * Routes that answer before anyone is signed in, each with the reason it has
 * to. Adding a route here is the deliberate act the test exists to force: the
 * list is short, it is reviewed, and an entry that is wrong is visible.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "health/route.ts": "liveness probe for the container, returns no data",
  "auth/register/route.ts": "sign up, by definition before a session exists",
  "auth/forgot-password/route.ts": "password reset request, no session yet",
  "auth/reset-password/route.ts": "consumes a signed reset token instead",
  "auth/[...nextauth]/route.ts": "NextAuth's own handler, it issues sessions",
  "google/auth/route.ts": "starts the Google sign in redirect",
  "google/callback/route.ts": "Google returns here, still signed out",
  "google/2fa/route.ts": "second factor, gated by a signed challenge cookie",
  "team/invite/validate/route.ts": "an invited person reads their invitation before they have an account",
};

/** Any of these means the route established who is calling. */
const AUTHENTICATORS = [
  "await auth()",
  "authenticateApiRequest",
  "verifyCronRequest",
];

/** Any of these in a where clause means the lookup was narrowed to an owner. */
const SCOPES = ["workspaceId", "userId", "ownerId", "teamId", "user.id"];

/**
 * Routes that read by id without an owner column, each with the reason. An
 * admin route is scoped by the caller's admin flag rather than by ownership,
 * which is a different check and is asserted separately below.
 */
const UNSCOPED_ROUTES: Record<string, string> = {
  "admin/users/[id]/route.ts": "administrator acting across accounts, gated on isAdmin",
};

function routeFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...routeFiles(path.join(dir, entry.name), rel));
    else if (entry.name === "route.ts") out.push(rel);
  }
  return out;
}

const ROUTES = routeFiles(API_DIR);
const read = (rel: string) => readFileSync(path.join(API_DIR, rel), "utf8");
const isDynamic = (rel: string) => /\[[^\]]+\]/.test(path.dirname(rel));

test("there are routes to check, so a broken walk cannot pass as a clean sweep", () => {
  // Without this the whole file passes vacuously the day someone moves the
  // api directory: zero routes, zero failures, green tick.
  assert.ok(ROUTES.length > 50, `expected the full api surface, walked ${ROUTES.length}`);
  assert.ok(ROUTES.some(isDynamic), "expected routes taking an id in the path");
});

test("every route authenticates the caller, or is a named exception", () => {
  const unguarded = ROUTES.filter(
    (rel) => !(rel in PUBLIC_ROUTES) && !AUTHENTICATORS.some((a) => read(rel).includes(a))
  );
  assert.deepEqual(
    unguarded,
    [],
    "these routes call no authenticator and are not listed as public. Either " +
      "authenticate them, or add them to PUBLIC_ROUTES with the reason they " +
      "answer to anyone:\n  " + unguarded.join("\n  ")
  );
});

test("the public list names only routes that exist", () => {
  // A stale entry silently exempts nothing today and may exempt a future
  // route that happens to reuse the path.
  const stale = Object.keys(PUBLIC_ROUTES).filter((rel) => !ROUTES.includes(rel));
  assert.deepEqual(stale, [], `PUBLIC_ROUTES names routes that are gone: ${stale.join(", ")}`);
});

test("every route that reads by an id from the path narrows it to an owner", () => {
  const unscoped = ROUTES.filter(isDynamic)
    .filter((rel) => !(rel in UNSCOPED_ROUTES) && !(rel in PUBLIC_ROUTES))
    .filter((rel) => {
      const src = read(rel);
      return !SCOPES.some((s) => src.includes(s));
    });
  assert.deepEqual(
    unscoped,
    [],
    "these routes take an id from the URL and never mention an owner column, " +
      "so the id alone decides which record is returned:\n  " + unscoped.join("\n  ")
  );
});

/**
 * Pull out each `and(...)` call with its parentheses balanced, so a nested
 * `eq(a, b)` inside it is part of the same clause rather than a separate match.
 */
function andClauses(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf("and("); i !== -1; i = src.indexOf("and(", i + 1)) {
    let depth = 0;
    for (let j = i + 3; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) {
          out.push(src.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

test("a lookup by id is never the only condition in its where clause", () => {
  // The specific shape of the bug: `where(eq(table.id, id))` on a table that
  // belongs to somebody. With `and(...)` the ownership column sits alongside.
  const offenders: string[] = [];
  for (const rel of ROUTES) {
    if (!isDynamic(rel) || rel in UNSCOPED_ROUTES || rel in PUBLIC_ROUTES) continue;
    for (const clause of andClauses(read(rel))) {
      const looksUpById = /eq\(\s*\w+\.id\s*,/.test(clause);
      if (looksUpById && !SCOPES.some((s) => clause.includes(s))) {
        offenders.push(`${rel}: ${clause.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these where clauses match a record by id with no owner condition beside it:\n  " +
      offenders.join("\n  ")
  );
});

test("the administrator exception really is gated on being an administrator", () => {
  for (const [rel, reason] of Object.entries(UNSCOPED_ROUTES)) {
    assert.ok(ROUTES.includes(rel), `UNSCOPED_ROUTES names a route that is gone: ${rel}`);
    assert.match(
      read(rel),
      /isAdmin/,
      `${rel} is exempt from ownership scoping (${reason}) but never checks isAdmin`
    );
  }
});

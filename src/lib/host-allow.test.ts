import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The shape of the bug CodeQL found in three places, written down once.
 *
 * A host allow-list built from `includes` or a bare `endsWith` is not an
 * allow-list. Anyone can register r2.dev.attacker.com, evil-r2.dev or
 * notlinkedin.com, and each of those satisfies the check while belonging to
 * somebody else. In src/app/api/media/proxy that decided whether the server
 * would fetch a URL for you, which is a server-side request forgery; in the
 * MCP route it decided whether a URL became an agent source, which the worker
 * later opens in a browser signed in to the customer's LinkedIn account.
 *
 * These tests pin the rule the fixes now share. They are written against a
 * local copy of the predicate rather than imported from a route, because the
 * routes pull in the database and the session on import; the value here is
 * that the hostile inputs are recorded and a future rewrite has to answer them.
 */
const hostAllowed = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

test("the domain itself is allowed", () => {
  assert.equal(hostAllowed("linkedin.com", "linkedin.com"), true);
  assert.equal(hostAllowed("r2.dev", "r2.dev"), true);
});

test("a real subdomain is allowed", () => {
  assert.equal(hostAllowed("www.linkedin.com", "linkedin.com"), true);
  assert.equal(hostAllowed("pub-86332bae.r2.dev", "r2.dev"), true);
});

test("a domain that merely ends with the name is refused", () => {
  // Registerable today, and the reason a bare endsWith is not a boundary.
  assert.equal(hostAllowed("notlinkedin.com", "linkedin.com"), false);
  assert.equal(hostAllowed("my-linkedin.com", "linkedin.com"), false);
  assert.equal(hostAllowed("evil-r2.dev", "r2.dev"), false);
});

test("a domain that merely contains the name is refused", () => {
  // What `hostname.includes(domain)` accepted.
  assert.equal(hostAllowed("r2.dev.attacker.com", "r2.dev"), false);
  assert.equal(hostAllowed("linkedin.com.evil.net", "linkedin.com"), false);
  assert.equal(hostAllowed("attacker.com/?x=linkedin.com", "linkedin.com"), false);
});

test("an internal address is refused, which is what the forgery was reaching for", () => {
  assert.equal(hostAllowed("169.254.169.254", "r2.dev"), false);
  assert.equal(hostAllowed("localhost", "r2.dev"), false);
});

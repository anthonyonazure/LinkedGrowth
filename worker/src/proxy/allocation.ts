import { db } from "../db.ts";
import { decryptSecret } from "../crypto.ts";
import { instance } from "../instance.ts";
import { log } from "../logger.ts";
import type { ProxyAllocation } from "../browser/driver.ts";

/**
 * Where a LinkedIn account's address comes from.
 *
 * The dashboard orders the address the moment the customer picks a country and
 * binds it to their LinkedIn account, so the worker only ever reads. It reads
 * by **LinkedIn account**, never by agent and never by workspace, because the
 * invariant in plan section 5c is one account and one address however many
 * agents drive it, and publishing a post has no agent behind it at all.
 *
 * A missing or inactive row is not an error to route around. In production the
 * work is refused, because an account acting from the server's own address is
 * an account seen from a datacentre. The one exception is an instance whose
 * operator turned that address into the point: see requiresAllocation.
 */
export async function allocationFor(
  linkedinAccountId: string
): Promise<ProxyAllocation | null> {
  const { rows } = await db().execute({
    sql: `SELECT host, port, username_encrypted, password_encrypted, last_exit_ip
            FROM proxy_allocations
           WHERE linkedin_account_id = ? AND status = 'active'
           LIMIT 1`,
    args: [linkedinAccountId],
  });
  const row = rows[0];
  if (!row) return null;

  const username = decryptSecret(String(row.username_encrypted ?? ""));
  const password = decryptSecret(String(row.password_encrypted ?? ""));
  if (!username || !password) {
    log(`account ${linkedinAccountId}: address stored without credentials`);
    return null;
  }

  return {
    server: `http://${String(row.host)}:${Number(row.port)}`,
    username,
    password,
    // The driver asserts the observed exit against this before anything runs,
    // so an address that silently changed stops the session rather than acting
    // from somewhere the account has never been seen.
    expectedIp: String(row.last_exit_ip ?? ""),
  };
}

export function isProduction(): boolean {
  return process.env.WORKER_ENV === "production";
}

/**
 * Must this account have an address of its own before anything runs?
 *
 * Yes in production, which is the rule the four passes were written around. No
 * when the operator of a self hosted instance has said the server is already
 * sitting where the accounts should be seen from, which is true of a machine at
 * home or in an office and false of a rented one. The reasoning that refuses a
 * datacentre address has not changed; this only recognises that on somebody's
 * own connection there is no datacentre to hide from, and buying an address
 * would replace a real residential exit with a rented one.
 *
 * One helper rather than a copy of the check per pass, so the switch cannot be
 * honoured in three places and forgotten in the fourth.
 */
export async function requiresAllocation(): Promise<boolean> {
  if (!isProduction()) return false;
  return !(await instance()).directEgress;
}

/**
 * Does this address actually look like somebody's home connection?
 *
 * Plan section 5b: never buy on the marketing claim. A published comparison
 * found a "dedicated IP" promise served by a shared HostRoyale datacenter
 * exit, and re-resolving three competitors' addresses on 2026-07-30 put two of
 * them on hosting networks. The claim and the product diverge often enough in
 * this industry that the only evidence worth having is our own.
 *
 * This runs twice: once before an address is ever bound to an account, and once
 * a month afterwards, because an address that was residential when bought can
 * be reclassified later and we want to move before LinkedIn notices.
 *
 * It never blocks by itself. A hosting classification raises a flag and an
 * alert; pulling an address out from under a live account is a bigger event
 * than a bad score and stays a decision, not an automatic action.
 */

export interface ExitCheck {
  /** What the world sees when this proxy makes a request. */
  ip: string;
  asn: string | null;
  asnOrg: string | null;
  country: string | null;
  /** True when the network reads as a hosting company rather than an ISP. */
  looksHosted: boolean;
  /** Filled when the check could not complete, in which case nothing else is
   *  trustworthy and the caller should retry rather than conclude. */
  error?: string;
}

/**
 * Words that appear in the organisation name of hosting networks and almost
 * never in a consumer ISP's. Deliberately conservative: a false negative costs
 * us a monthly re-check, a false positive would move a healthy account.
 */
const HOSTING_WORDS = [
  "hosting", "host", "datacenter", "data center", "datacentre", "server",
  "cloud", "vps", "dedicated", "colocation", "colo ", "llc hosting",
  "digital ocean", "digitalocean", "linode", "vultr", "ovh", "hetzner",
  "contabo", "leaseweb", "choopa", "quadranet", "psychz", "hostroyale",
  "m247", "gcore", "scaleway", "aws", "amazon", "azure", "google cloud",
];

function readsAsHosting(org: string | null): boolean {
  if (!org) return false;
  const lower = org.toLowerCase();
  return HOSTING_WORDS.some((w) => lower.includes(w));
}

export interface ProxyCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Routes one request through the proxy and reports what came out the other side.
 *
 * Uses undici's ProxyAgent rather than shelling out to curl, for two reasons
 * that both bit us: a request handler on Vercel has no guaranteed curl binary
 * and restricted child processes, and a customer's proxy password would have
 * had to be shell-escaped into an argument list, which is a category of bug
 * worth designing out rather than getting right.
 */
export async function checkExit(
  proxy: ProxyCredentials,
  timeoutMs = 20_000
): Promise<ExitCheck> {
  const empty: ExitCheck = {
    ip: "",
    asn: null,
    asnOrg: null,
    country: null,
    looksHosted: false,
  };

  try {
    const { ProxyAgent } = await import("undici");
    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : "";
    const agent = new ProxyAgent({
      uri: `http://${auth}${proxy.host}:${proxy.port}`,
    });

    const response = await fetch("https://ipinfo.io/json", {
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: agent,
    } as RequestInit);
    if (!response.ok) {
      return { ...empty, error: `lookup returned HTTP ${response.status}` };
    }
    const data = (await response.json()) as {
      ip?: string;
      org?: string;
      country?: string;
    };

    // ipinfo returns org as "AS12322 Free SAS", so the number and the name come
    // apart on the first space.
    const org = data.org ?? null;
    const match = org?.match(/^(AS\d+)\s+(.*)$/);
    const asn = match?.[1] ?? null;
    const asnOrg = match?.[2] ?? org;
    return {
      ip: data.ip ?? "",
      asn,
      asnOrg,
      country: data.country ?? null,
      looksHosted: readsAsHosting(asnOrg),
    };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : "exit check failed",
    };
  }
}

/**
 * The same reading of this server's own connection, with no proxy in front.
 *
 * The instance setting that turns addresses off is only safe when the server
 * is already sitting on a consumer connection, so the switch has to be able to
 * show what LinkedIn would see rather than take the operator's word for it. A
 * hosting classification here is the whole reason the warning exists.
 */
export async function checkDirectExit(timeoutMs = 10_000): Promise<ExitCheck> {
  const empty: ExitCheck = {
    ip: "",
    asn: null,
    asnOrg: null,
    country: null,
    looksHosted: false,
  };

  try {
    const response = await fetch("https://ipinfo.io/json", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ...empty, error: `lookup returned HTTP ${response.status}` };
    }
    const data = (await response.json()) as {
      ip?: string;
      org?: string;
      country?: string;
    };
    const org = data.org ?? null;
    const match = org?.match(/^(AS\d+)\s+(.*)$/);
    const asn = match?.[1] ?? null;
    const asnOrg = match?.[2] ?? org;
    return {
      ip: data.ip ?? "",
      asn,
      asnOrg,
      country: data.country ?? null,
      looksHosted: readsAsHosting(asnOrg),
    };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : "exit check failed",
    };
  }
}

/**
 * What the operator is told when they turn addresses off. Never a refusal: the
 * switch exists for people who know their own network, and the classifier is a
 * guess about an organisation name rather than a fact about a connection.
 */
export function describeDirectExit(check: ExitCheck): { ok: boolean; detail: string } {
  if (check.error) return { ok: false, detail: `Could not read this server's address: ${check.error}` };
  if (!check.ip) return { ok: false, detail: "Could not read this server's address." };
  const network = check.asnOrg ?? "an unnamed network";
  const where = check.country ? ` in ${check.country}` : "";
  if (check.looksHosted) {
    return {
      ok: false,
      detail: `LinkedIn will see ${check.ip}${where} on ${network}, which reads as a hosting network rather than a consumer ISP. Accounts signing in from one of those are the ones that get challenged.`,
    };
  }
  return {
    ok: true,
    detail: `LinkedIn will see ${check.ip}${where} on ${network}, which reads as a consumer ISP rather than a hosting network.`,
  };
}

/**
 * The gate before an address is bound to a customer's LinkedIn account.
 *
 * Unreachable is a hard no, because an address that cannot answer now will not
 * carry a session later. A wrong country is a hard no, since the whole point is
 * that the account signs in from where its owner is. A hosting classification
 * is a warning rather than a refusal: it is a judgement about reputation and
 * refusing on it would leave some countries unservable.
 */
export function acceptForBinding(
  check: ExitCheck,
  expectedCountry: string
): { ok: boolean; reason?: string; warn?: string } {
  if (check.error) return { ok: false, reason: `Address unreachable: ${check.error}` };
  if (!check.ip) return { ok: false, reason: "Address returned no exit IP" };
  if (
    check.country &&
    check.country.toUpperCase() !== expectedCountry.toUpperCase()
  ) {
    return {
      ok: false,
      reason: `Address exits in ${check.country}, not ${expectedCountry}`,
    };
  }
  if (check.looksHosted) {
    return {
      ok: true,
      warn: `Exit ${check.ip} resolves to ${check.asnOrg}, which reads as a hosting network rather than a consumer ISP`,
    };
  }
  return { ok: true };
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { insightEvents } from "@/lib/db/schema";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

/**
 * Where this instance's own analytics land.
 *
 * The upstream layout loaded a tracker from a third party's domain and posted
 * every page view to them. This is the replacement: the same event shape,
 * received by this instance, written to this instance's database, read back on
 * /insight. Nothing leaves the machine.
 *
 * Public by necessity. A beacon fires from the browser as a page is being torn
 * down, so there is no session to check and the response has to be immediate.
 * Everything below follows from that: the body is capped before it is parsed,
 * every field is bounded, unknown fields are dropped rather than stored, and
 * the whole thing is rate limited by address.
 */

/** A beacon is a few hundred bytes. Anything larger is not a beacon. */
const MAX_BODY_BYTES = 4096;

/** The tracker's own event names. Anything else is not written. */
const TYPES = new Set(["pageview", "ping", "click", "goal", "purchase", "custom"]);

const INSIGHT_RATE_LIMIT = { windowMs: 60_000, maxRequests: 240 };

/** Bounded text, or null. Empty strings are stored as null so a query can tell them apart. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function count(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 0) return null;
  return Math.min(n, max);
}

/**
 * The path, without the query string, and without a host.
 *
 * This is the whole privacy argument for running our own collector. The
 * tracker sends `url` (absolute) and `query` alongside `path`, and this app's
 * URLs carry agent ids, lead ids and invitation tokens. Storing the absolute
 * URL would put those in a table whose entire purpose is to be graphed, so the
 * two fields are read, ignored, and never given a column to live in.
 */
function pathOnly(value: unknown): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  const withoutQuery = raw.split("?")[0].split("#")[0];
  if (!withoutQuery.startsWith("/")) return null;
  return withoutQuery.slice(0, 512);
}

/**
 * The referrer's origin, never its full address.
 *
 * A full referrer can carry another site's own query string, which is somebody
 * else's data arriving in our database by accident.
 */
function referrerOrigin(value: unknown): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  try {
    return new URL(raw).origin.slice(0, 255);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit(`insight:${getClientIP(request)}`, INSIGHT_RATE_LIMIT);
    if (!limit.success) {
      // 204 rather than 429. A beacon cannot read a response or retry, and a
      // visible error on an analytics endpoint tells a prober it found one.
      return new NextResponse(null, { status: 204 });
    }

    // Read as text and measure before parsing: JSON.parse on an unbounded body
    // is the cost an attacker gets to choose.
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return new NextResponse(null, { status: 204 });
    }

    const type = text(body.type, 32);
    const path = pathOnly(body.path ?? body.url);
    if (!type || !TYPES.has(type) || !path) return new NextResponse(null, { status: 204 });

    await db.insert(insightEvents).values({
      id: randomUUID(),
      site: text(body.site, 64) ?? "unknown",
      type,
      visitorId: text(body.iid, 64),
      path,
      referrer: referrerOrigin(body.referrer),
      lang: text(body.lang, 16),
      screenWidth: count(body.sw, 20000),
      utmSource: text(body.utm_source, 128),
      utmMedium: text(body.utm_medium, 128),
      utmCampaign: text(body.utm_campaign, 128),
      durationMs: count(body.duration_ms, 86_400_000),
      goal: text(body.goal, 64),
      clickTarget: referrerOrigin(body.click_target),
      createdAt: new Date(),
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    // Analytics must never be able to take a page down with it, and a stack
    // trace here would describe the database to anyone who posts nonsense.
    return new NextResponse(null, { status: 204 });
  }
}

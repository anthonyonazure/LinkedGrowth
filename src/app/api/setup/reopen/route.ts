/**
 * Reopening the wizard, the other side of the door that complete/route.ts shuts.
 *
 * Finishing the wizard was one way: the flag went up and the only route back
 * was an edit to the row by hand. That is the wrong shape for a state a person
 * reaches through the interface, so an administrator can lower it again and
 * walk the 6 steps with everything already saved in the fields.
 *
 * Nothing is cleared. The keys, the addresses and the storage settings all
 * stay, so this reopens a filled in wizard rather than starting an empty one.
 * The dashboard stays shut until the wizard is finished again, which is the
 * same rule a fresh install lives under and the reason the caller is told.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSelfHosted } from "@/lib/edition";
import { updateInstanceSettings } from "@/lib/instance-settings";
import { rateLimit, AUTH_RATE_LIMITS } from "@/lib/rate-limit";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.user.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!isSelfHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const limit = rateLimit(`setup:${session.user.id}`, AUTH_RATE_LIMITS.setup);
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
      );
    }

    await updateInstanceSettings({ setupCompleted: false });
    // The middleware holds its own answer for a few seconds, so a redirect
    // sent this instant can still be bounced back. The caller waits that out
    // rather than racing it.
    return NextResponse.json({ ok: true, next: "/setup", readyInMs: 6000 });
  } catch {
    return NextResponse.json({ error: "Could not reopen the setup wizard" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

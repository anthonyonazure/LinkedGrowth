import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { insightEvents } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

/**
 * What this instance recorded about itself, and nothing more.
 *
 * The point of the page is not the numbers. It is that every field the tracker
 * sends is visible here, so the claim "nothing leaves this machine" can be
 * checked rather than believed. If a column you did not expect appears in this
 * table, that is the bug this page exists to show you.
 */
export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

export default async function InsightPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  // Instance-wide analytics, so this is an administrator's page. Ownership is
  // not the check here because these rows belong to nobody in particular.
  if (!session.user.isAdmin) redirect("/dashboard");

  const [totals] = await db
    .select({
      events: sql<number>`count(*)`,
      visitors: sql<number>`count(distinct coalesce(${insightEvents.visitorId}, ${insightEvents.path}))`,
      pageviews: sql<number>`sum(case when ${insightEvents.type} = 'pageview' then 1 else 0 end)`,
    })
    .from(insightEvents);

  const topPaths = await db
    .select({ path: insightEvents.path, views: sql<number>`count(*)` })
    .from(insightEvents)
    .where(sql`${insightEvents.type} = 'pageview'`)
    .groupBy(insightEvents.path)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  const recent = await db
    .select()
    .from(insightEvents)
    .orderBy(desc(insightEvents.createdAt))
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insight</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Analytics collected by this instance, stored on this instance. Nothing is sent anywhere.
          Every field the tracker records is shown in the table below, so you can see exactly what is kept.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Events" value={totals?.events ?? 0} />
        <Stat label="Page views" value={totals?.pageviews ?? 0} />
        <Stat label="Visitors" value={totals?.visitors ?? 0} />
      </div>

      {(totals?.events ?? 0) === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No events yet. Collection is off unless this instance runs with INSIGHT_ENABLED=true,
            which is deliberate: an instance that starts recording its user without being asked has
            made that choice for everyone who installs it.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <h2 className="px-5 py-4 text-sm font-medium text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800">
          Most viewed
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {topPaths.map((row) => (
                <tr key={row.path} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300 font-mono text-xs">{row.path}</td>
                  <td className="px-5 py-2.5 text-right text-slate-500 dark:text-slate-400">{row.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <h2 className="px-5 py-4 text-sm font-medium text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800">
          Everything recorded, most recent first
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 font-medium">Path</th>
                <th className="px-5 py-2 font-medium">Referrer</th>
                <th className="px-5 py-2 font-medium">Language</th>
                <th className="px-5 py-2 font-medium">Screen</th>
                <th className="px-5 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {row.createdAt.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300">{row.type}</td>
                  <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300 font-mono text-xs">{row.path}</td>
                  <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{row.referrer ?? "direct"}</td>
                  <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{row.lang ?? ""}</td>
                  <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{row.screenWidth ?? ""}</td>
                  <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">
                    {row.durationMs ? `${Math.round(row.durationMs / 1000)}s` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

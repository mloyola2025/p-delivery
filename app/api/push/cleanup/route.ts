import { NextResponse } from "next/server";
import { pruneStaleSubscriptions } from "../../../../lib/notificationService";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!vercelCron && (!cronSecret || authorization !== `Bearer ${cronSecret}`))
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const deactivated = await pruneStaleSubscriptions();
  await ensureCloudSchema();
  const sql = getCloudDb();
  const expiredLimits = await sql<{ key: string }[]>`
    delete from auth_rate_limits
    where updated_at < now() - interval '2 days'
      and (blocked_until is null or blocked_until < now())
    returning key
  `;
  return NextResponse.json({
    ok: true,
    deactivated,
    expiredLoginLimits: expiredLimits.length,
  });
}

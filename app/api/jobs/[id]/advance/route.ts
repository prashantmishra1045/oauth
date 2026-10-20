import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { internalSecret } from "@/lib/agent/client";
import { runJob } from "@/lib/agent/pipeline";

export const maxDuration = 300;

/** Internal: a job's previous invocation hands the next stages to a fresh one. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/jobs/[id]/advance">) {
  const given = Buffer.from(request.headers.get("x-greenlight-secret") ?? "");
  const expected = Buffer.from(internalSecret());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  after(() => runJob(id));
  return Response.json({ ok: true }, { status: 202 });
}

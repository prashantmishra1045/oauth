import { after, type NextRequest } from "next/server";
import { needsResume, runJob } from "@/lib/agent/pipeline";
import { STAGES } from "@/lib/agent/types";
import { getStore } from "@/lib/store";

export const maxDuration = 300;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const from = Math.max(0, Number(request.nextUrl.searchParams.get("after") ?? 0) || 0);
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) return Response.json({ error: "No such job." }, { status: 404 });

  // Watchdog: if a stage hand-off was lost or a runner died, this poll resumes the job.
  if (needsResume(job)) after(() => runJob(id));

  const events = await store.getEvents(id, from);
  return Response.json(
    {
      job: {
        id: job.id,
        query: job.query,
        status: job.status,
        stage: job.stage,
        stageIndex: STAGES.indexOf(job.stage),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        appName: job.resolution?.name ?? null,
        guideSlug: job.guideSlug ?? null,
        followJobId: job.followJobId ?? null,
        factCheck: job.verified?.verification.status ?? null,
        error: job.error ?? null,
        replay: Boolean(job.replay),
        usage: job.usage,
        probes: job.probes.length,
        durable: store.durable,
      },
      events,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

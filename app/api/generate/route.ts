import { after, type NextRequest } from "next/server";
import { runJob, startJob } from "@/lib/agent/pipeline";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let query = "";
  try {
    query = String(((await request.json()) as { query?: unknown }).query ?? "");
  } catch {
    return Response.json({ error: "Send JSON: {\"query\": \"app name or website\"}" }, { status: 400 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const result = await startJob({ query, origin: request.nextUrl.origin, ip });

  if (result.kind === "error") return Response.json({ error: result.message }, { status: result.status });
  if (result.kind === "guide") return Response.json({ guideSlug: result.slug });

  // The job runs after the response is sent, within this function's maxDuration.
  after(() => runJob(result.jobId));
  return Response.json({ jobId: result.jobId }, { status: 202 });
}

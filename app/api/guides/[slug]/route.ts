import type { NextRequest } from "next/server";
import { getGuide } from "@/lib/guide/get";
import { guideToMarkdown } from "@/lib/guide/markdown";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/guides/[slug]">) {
  const { slug } = await ctx.params;
  const found = await getGuide(slug);
  if (!found) return Response.json({ error: "No guide with that slug." }, { status: 404 });
  if (request.nextUrl.searchParams.get("format") === "md") {
    const md = guideToMarkdown(found.guide, `${request.nextUrl.origin}/guides/${slug}`);
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-oauth-guide.md"`,
      },
    });
  }
  return Response.json(found.guide);
}

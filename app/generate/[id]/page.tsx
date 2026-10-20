import type { Metadata } from "next";
import { Suspense } from "react";
import { JobFeed } from "@/components/JobFeed";

export const metadata: Metadata = { title: "Generating a guide" };

export default function GeneratePage({ params }: PageProps<"/generate/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-4 py-16 text-zinc-500">Loading…</div>}>
      <Feed params={params} />
    </Suspense>
  );
}

async function Feed({ params }: { params: PageProps<"/generate/[id]">["params"] }) {
  const { id } = await params;
  return <JobFeed jobId={id} />;
}

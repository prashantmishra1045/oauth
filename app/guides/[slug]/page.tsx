import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GuideView } from "@/components/guide/GuideView";
import { getGuide } from "@/lib/guide/get";
import { listLibraryGuides } from "@/lib/guide/library";

export function generateStaticParams() {
  return listLibraryGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const found = await getGuide(slug);
  if (!found) return { title: "Guide not found" };
  return { title: `${found.guide.app.name} OAuth app guide`, description: found.guide.summary.headline };
}

export default function GuidePage({ params }: PageProps<"/guides/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-16 text-zinc-500">Loading guide…</div>}>
      <GuideLoader params={params} />
    </Suspense>
  );
}

async function GuideLoader({ params }: { params: PageProps<"/guides/[slug]">["params"] }) {
  const { slug } = await params;
  const found = await getGuide(slug);
  if (!found) notFound();
  return (
    <>
      <div className="no-print mx-auto max-w-6xl px-4 pt-6 text-sm">
        <Link href="/" className="text-zinc-500 hover:text-zinc-900">
          ← All guides
        </Link>
      </div>
      <GuideView guide={found.guide} source={found.source} />
    </>
  );
}

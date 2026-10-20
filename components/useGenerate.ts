"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useState } from "react";

/** Starts (or joins) a live generation and navigates to the guide or its progress page. */
export function useGenerate() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // With Cache Components, a page the user navigates away from is hidden (not unmounted) and
  // keeps its state; reset it when hidden so Back doesn't show buttons stuck on "Starting…".
  useLayoutEffect(
    () => () => {
      setPending(null);
      setError(null);
    },
    [],
  );

  async function start(query: string) {
    setError(null);
    setPending(query);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = (await res.json()) as { guideSlug?: string; jobId?: string; error?: string };
      if (body.guideSlug) router.push(`/guides/${body.guideSlug}`);
      else if (body.jobId) router.push(`/generate/${body.jobId}`);
      else throw new Error(body.error || `Request failed (${res.status})`);
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
    }
  }

  return { start, pending, error };
}

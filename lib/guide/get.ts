import { getStore } from "@/lib/store";
import { getLibraryGuide } from "./library";
import { Guide } from "./schema";

/** Library guides win; otherwise a guide the live agent generated. */
export async function getGuide(slug: string): Promise<{ guide: Guide; source: "library" | "live" } | null> {
  const lib = getLibraryGuide(slug);
  if (lib) return { guide: lib, source: "library" };
  const stored = await getStore().getGuide(slug);
  if (!stored) return null;
  const parsed = Guide.safeParse(stored);
  return parsed.success ? { guide: parsed.data, source: "live" } : null;
}

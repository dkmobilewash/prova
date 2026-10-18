import { redirect } from "next/navigation";
import { forwardQuery, parsePrefill, stateSlug } from "@/lib/prefill";
import { isPublished } from "@/lib/statutes/review";
import { StatePicker } from "@/components/StatePicker";

/**
 * The state picker at /lien-waiver/start. On cstream.ai the C-Stream app owns
 * /lien-waiver itself (Cyrus's landing page), so this app's own home page is
 * only reachable on its Vercel domain. Its "Make my waiver" button points
 * here (LIEN_WAIVER_TOOL_URL on prova-web).
 *
 * A pre-fill link (lib/prefill.ts) may name a state: `?state=CA` goes
 * straight to California's page, carrying the link's other known values and
 * nothing else. A state that is not one of ours, or one this deployment may
 * not show (Texas in production, until it is reviewed), falls back to the
 * picker. With no query at all this renders the picker exactly as before.
 *
 * The redirect is a PATH, not a URL, on purpose: on cstream.ai this page is
 * reached through prova-web's rewrite, and a Location naming this app's own
 * Vercel host would send the visitor off cstream.ai.
 */
export default async function Start({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }
  const { state } = parsePrefill(params);
  if (state && isPublished(state)) redirect(`/${stateSlug(state)}${forwardQuery(params)}`);
  return <StatePicker query={forwardQuery(params)} />;
}

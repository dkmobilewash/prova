import { AskPanel } from "@/components/AskPanel";

export const metadata = { title: { absolute: "Ask C Stream" } };

/**
 * The assistant, with the room to itself.
 *
 * The Topbar launcher (AskLauncher) is the one people will use most — it is
 * on every page and costs no navigation. This page exists so the rail has
 * somewhere to point: a group heading with no destination is not findable,
 * and the assistant is the thing worth finding.
 *
 * Same `<AskPanel initialQuestion={initialQuestion} />` as the launcher and the dashboard. No capability gate
 * on the route, matching /dashboard — the commands gate themselves by
 * capability inside the panel, so a person only ever sees what they could
 * already do.
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  // Prefilled from the command palette's "Ask C Stream: …" row. Text only —
  // nothing is asked until the person presses Ask.
  const { q } = await searchParams;
  const initialQuestion = typeof q === "string" ? q.slice(0, 500) : "";
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Ask C Stream</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-body">
        Ask about your jobs, money, drawings or crews in plain words — or tell it to do
        something, and it will show you exactly what it will change before anything is
        written.
      </p>
      <div className="mt-6" data-tour="ask-panel">
        {/* Keyed so a second palette ask while already on /ask re-seeds the box. */}
        <AskPanel key={initialQuestion} initialQuestion={initialQuestion} />
      </div>
    </div>
  );
}

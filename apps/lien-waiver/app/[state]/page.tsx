import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { WaiverTool } from "@/components/WaiverTool";
import { STATE_CONTENT } from "@/lib/content";
import { isPublished, reviewStatus } from "@/lib/statutes/review";
import { STATES, type StateCode } from "@/lib/statutes/types";

/** One page per state. A state that may not be shown here -- in production,
 * one no attorney has reviewed -- is a 404, not a page with a warning on it. */

function stateFor(slug: string): StateCode | null {
  return STATES.find((state) => STATE_CONTENT[state].slug === slug) ?? null;
}

export function generateStaticParams() {
  return STATES.filter((state) => isPublished(state)).map((state) => ({ state: STATE_CONTENT[state].slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }): Promise<Metadata> {
  const state = stateFor((await params).state);
  if (!state) return {};
  const content = STATE_CONTENT[state];
  return {
    title: `${content.name} lien waiver forms`,
    description: `Fill out ${content.name}'s statutory lien waiver (${content.statute}) on your phone and download the PDF. Conditional and unconditional, progress and final. Free.`,
  };
}

export default async function StatePage({ params }: { params: Promise<{ state: string }> }) {
  const state = stateFor((await params).state);
  if (!state || !isPublished(state)) notFound();
  const content = STATE_CONTENT[state];
  const reviewed = reviewStatus(state).reviewed;
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-8">
        <Link href="/" className="inline-flex min-h-touch items-center text-sm text-quiet underline">
          All states
        </Link>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">{content.name} lien waiver</h1>
        <p className="mt-2 text-quiet">
          The four statutory forms in {content.statute}, copied from the official text.
        </p>
        {!reviewed ? (
          <p role="note" className="mt-4 rounded-lg border-2 border-warn bg-warn-ground p-4 font-semibold text-warn">
            Preview: {content.name}&apos;s forms have not been reviewed by an attorney yet. Every PDF from this page is
            watermarked &quot;do not sign&quot;.
          </p>
        ) : null}
        <WaiverTool state={state} />

        <details className="mt-10 rounded-lg border border-line bg-paper p-4">
          <summary className="min-h-touch cursor-pointer py-2 font-semibold text-ink">
            About {content.name}&apos;s waiver statute
          </summary>
          <dl className="mt-2 space-y-3 text-quiet">
            <div>
              <dt className="font-semibold text-ink">How closely the form must be followed</dt>
              <dd>{content.formRequirement}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Who signs</dt>
              <dd>{content.signer}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Notary</dt>
              <dd>{content.notarization}</dd>
            </div>
            {content.notes.map((note) => (
              <div key={note}>
                <dd>{note}</dd>
              </div>
            ))}
          </dl>
        </details>
      </main>
      <SiteFooter />
    </>
  );
}

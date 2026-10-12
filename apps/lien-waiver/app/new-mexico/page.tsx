import type { Metadata } from "next";
import Link from "next/link";
import { NotifyForm } from "@/components/NotifyForm";
import { SiteFooter } from "@/components/SiteFooter";
import { NEW_MEXICO } from "@/lib/content";

/**
 * New Mexico has no statutory lien waiver form, so this page offers none.
 * Inventing one -- or borrowing a neighbour's -- would put words in front
 * of a sub that no statute stands behind, which is the one thing this tool
 * exists not to do. The finding is in docs/lien-waiver/research.md.
 */
export const metadata: Metadata = {
  title: "New Mexico lien waivers",
  description: "New Mexico has no statutory lien waiver form. What that means for the form your GC sends you.",
};

export default function NewMexico() {
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-8">
        <Link href="/" className="inline-flex min-h-touch items-center text-sm text-quiet underline">
          All states
        </Link>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">New Mexico lien waivers</h1>
        <p className="mt-4 text-lg font-semibold text-ink">New Mexico has no statutory lien waiver form.</p>
        <p className="mt-3 text-quiet">{NEW_MEXICO.finding}</p>
        <p className="mt-3 text-quiet">{NEW_MEXICO.consequence}</p>
        <p className="mt-3 text-quiet">
          So there is nothing here for us to fill in for you yet. We would rather say that than hand you a form no statute
          backs.
        </p>
        <section className="mt-10 rounded-lg border-2 border-ink bg-paper p-4">
          <h2 className="text-xl font-bold text-ink">Get told when we add New Mexico tools</h2>
          <NotifyForm state="NM" />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

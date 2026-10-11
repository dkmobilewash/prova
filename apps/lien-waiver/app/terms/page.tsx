import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";

/** Terms of use. Draft for the attorney packet; plain on purpose. */
export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-8 text-quiet">
        <Link href="/" className="inline-flex min-h-touch items-center text-sm underline">
          All states
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-ink">Terms of use</h1>
        <p className="mt-2 text-sm">Last updated October 8, 2026.</p>

        <h2 className="mt-8 text-xl font-bold text-ink">What this tool does</h2>
        <p className="mt-3">
          It prints the lien waiver form your state&apos;s statute sets out, with what you typed in the blanks. The form
          text is copied from the official published statute, and each page and PDF names the statute and where the
          text came from.
        </p>

        <h2 className="mt-8 text-xl font-bold text-ink">What it does not do</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>It is not legal advice, and C-Stream is not a law firm. Using it does not make us your lawyer.</li>
          <li>It does not tell you whether to sign a waiver, or which form your contract or GC requires.</li>
          <li>It does not work out any deadline.</li>
          <li>
            It does not check that what you typed is right. You are responsible for the names, amounts and dates on
            your waiver, and for reading the whole form before you sign it.
          </li>
          <li>
            Statutes change. We record the date each form&apos;s text was retrieved; if your waiver matters, check it
            against the current statute or with a construction attorney.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-bold text-ink">No warranty</h2>
        <p className="mt-3">
          The tool is free and provided as is. To the extent the law allows, C-Stream is not liable for any loss from
          using it or from any waiver made with it.
        </p>

        <h2 className="mt-8 text-xl font-bold text-ink">Fair use</h2>
        <p className="mt-3">
          Use it for your own waivers. Do not use it to send email to people who did not ask for it, or to make
          automated requests.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

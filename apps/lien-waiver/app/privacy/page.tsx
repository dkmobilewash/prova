import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { LIMITS } from "@/lib/rate-limit";

/**
 * Privacy notice. Every sentence here is checked against what the code
 * does, and goes to the attorney with the forms (docs/lien-waiver/
 * attorney-packet.md). If the code changes what it collects, this page
 * changes in the same commit.
 */
export const metadata: Metadata = { title: "Privacy" };

const CONTACT = "diego@cstream.ai";

export default function Privacy() {
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-8 text-quiet">
        <Link href="/" className="inline-flex min-h-touch items-center text-sm underline">
          All states
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-ink">Privacy</h1>
        <p className="mt-2 text-sm">Last updated October 8, 2026.</p>

        <h2 className="mt-8 text-xl font-bold text-ink">What we collect</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-ink">When you download a waiver the first time:</strong> your name, your email
            address, your company if you give it, and whether you ticked the box to get marketing email.
          </li>
          <li>
            <strong className="text-ink">When you ask to be told about a new state:</strong> the same, plus the state.
          </li>
          <li>
            <strong className="text-ink">What you type into the waiver</strong> (project, owner, GC, amounts, dates) is
            sent to our server only to make your PDF and, when you ask for it, to email the PDF to you. We do not
            keep a copy of it, and it is not in the note we send ourselves about your download.
          </li>
          <li>
            <strong className="text-ink">To stop abuse,</strong> we keep a scrambled (salted and hashed) form of your IP
            address and email address with the time of each request, for up to two days. It limits how many PDFs one
            connection can make in an hour ({LIMITS.pdfPerIpPerHour}) and how many emails one address gets in a day (
            {LIMITS.emailsPerAddressPerDay}). It cannot be turned back into your address.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-bold text-ink">What stays on your phone</h2>
        <p className="mt-3">
          Your answers and your name and email are saved in your browser&apos;s own storage so the form is filled in
          next time and you are not asked for your email again. That stays on your device. The &quot;Forget them&quot;
          link on any state page clears it.
        </p>

        <h2 className="mt-8 text-xl font-bold text-ink">Why</h2>
        <p className="mt-3">
          To send you your PDF, to stop the tool being abused, and to know who uses it. C-Stream makes software for
          commercial subcontractors, and we may contact you about it once. If you tick the marketing box we may email
          you occasionally; if you do not, the only email you get from this tool is the one with your PDF.
        </p>

        <h2 className="mt-8 text-xl font-bold text-ink">Who else sees it</h2>
        <p className="mt-3">
          We never sell your information. We use service providers to run the tool: Vercel hosts it, Resend sends the
          email and keeps our contact list, and Neon hosts the database that holds the scrambled rate-limit records.
          They handle it on our behalf.
        </p>

        <h2 className="mt-8 text-xl font-bold text-ink">Deleting it</h2>
        <p className="mt-3">
          Email{" "}
          <a className="underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>{" "}
          and we will delete your name and email from our contact list. Every marketing email has an unsubscribe link.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

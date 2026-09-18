import type { Metadata } from "next";
import { PublicDocument } from "@/components/PublicDocument";

/**
 * The privacy policy — public, no sign-in. Intuit requires its URL before
 * issuing production QuickBooks keys, and anyone connecting their books is
 * owed it anyway.
 *
 * WRITTEN FROM THE CODE, NOT FROM A TEMPLATE. Every service named below is
 * one this app actually calls (packages/integrations/src and the
 * dependencies in apps/web/package.json), and nothing is promised that the
 * code does not already do. It deliberately makes no claim about encryption
 * at rest, certifications or retention periods, because nobody has verified
 * any. If you add a service that receives customer data, add it here in the
 * same commit. Not reviewed by a lawyer; the owners should before relying on
 * it as one.
 */

export const metadata: Metadata = { title: "Privacy — C Stream" };

export default function PrivacyPage() {
  return (
    <PublicDocument title="Privacy" updated="18 September 2026">
      <p>
        C Stream is software for specialty-trade subcontractors: jobs, estimates, crews, compliance
        paperwork and billing. This page says what information it keeps, where it goes, and what it
        does not do. It describes the app as it is built today.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>Your sign-in details — name, email address — so you can log in.</li>
        <li>
          What you and your team put in: your company record, clients and contacts, vendors, jobs,
          estimates, line items, time and crew records, documents and photos you upload, invoices and
          payments.
        </li>
        <li>
          For crew members, only the last four digits of a Social Security number, never the whole
          number. Imports refuse a file or record carrying a whole one.
        </li>
        <li>A record of changes and sync attempts, so you can see what happened and when.</li>
      </ul>

      <h2>Who else handles it</h2>
      <p>C Stream runs on other companies&apos; services. Each one receives only what its job needs:</p>
      <ul>
        <li>Vercel hosts the app and stores uploaded files.</li>
        <li>Neon hosts the database.</li>
        <li>Clerk handles sign-in.</li>
        <li>Resend sends email you ask the app to send, such as a document to a general contractor.</li>
        <li>
          Anthropic runs the assistant (the Ask box). What you type there, plus the records needed to
          answer it, is sent to Anthropic to produce the answer.
        </li>
        <li>Expo delivers notifications to the phone app.</li>
      </ul>

      <h2>QuickBooks Online and Jobber</h2>
      <p>These connect only when the account owner chooses to connect them.</p>
      <ul>
        <li>
          <strong>QuickBooks Online.</strong> When connected, C Stream stores the access Intuit grants.
          It pushes an invoice or payment to QuickBooks only when you press the button to do so. It
          reads your chart of accounts for the account mapping, reads back what it pushed to check it
          landed correctly, and, if you choose to import, reads your customers, vendors and products and
          services once. The import never changes anything in QuickBooks.
        </li>
        <li>
          <strong>Jobber.</strong> When connected, C Stream reads your clients, jobs and quotes once when
          you import. It never changes anything in Jobber.
        </li>
        <li>
          Disconnecting stops all of this. Records already brought into C Stream stay, because they are
          your company&apos;s records now.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your information, and there is no advertising in C Stream.</li>
        <li>
          Your company&apos;s records are not visible to any other company using C Stream, except what you
          choose to share — a client portal link or a document sent for signature shows the person you
          send it to that job or document.
        </li>
      </ul>

      <h2>Your records</h2>
      <p>
        The account owner can download the company&apos;s core records at any time from Settings → Export
        core records. To ask for your company&apos;s data to be deleted, contact us using the details
        below.
      </p>

      <h2>Changes</h2>
      <p>If this page changes, the date at the top changes with it.</p>
    </PublicDocument>
  );
}

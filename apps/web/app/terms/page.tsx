import type { Metadata } from "next";
import { PublicDocument } from "@/components/PublicDocument";

/**
 * Terms of use (Intuit's form calls this the End User License Agreement) —
 * public, no sign-in. Required as a URL before Intuit issues production
 * QuickBooks keys.
 *
 * Plain and short on purpose, and limited to what is true of the product: it
 * states how the app behaves and what the person is responsible for. It
 * names no governing law, fees or liability caps, because nobody has decided
 * any — those are the owners' call, with a lawyer, not an agent's. Until
 * they write them, this page says only what can be stood behind.
 */

export const metadata: Metadata = { title: "Terms — C Stream" };

export default function TermsPage() {
  return (
    <PublicDocument title="Terms of use" updated="18 September 2026">
      <p>
        These terms cover using C Stream, the software at app.cstream.ai and its phone app. By creating
        an account or using the app you agree to them. Our{" "}
        <a href="/privacy" className="text-link hover:text-link-hover">
          privacy page
        </a>{" "}
        says what happens to your information.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your sign-in to yourself. You are responsible for what is done under your account.</li>
        <li>
          The person who creates a company in C Stream is its account owner and decides who else on the
          team can use it and what they can do.
        </li>
      </ul>

      <h2>Your information</h2>
      <ul>
        <li>What you put into C Stream stays yours. We use it to run the app for you, and for nothing else.</li>
        <li>
          Only put in information you have the right to use. Do not upload a whole Social Security
          number; C Stream keeps only the last four digits and refuses the rest.
        </li>
        <li>The account owner can export the company&apos;s core records at any time from Settings.</li>
      </ul>

      <h2>Connected services</h2>
      <p>
        If you connect QuickBooks Online or Jobber, you also agree to that service&apos;s own terms.
        C Stream only sends an invoice or payment to QuickBooks when you press the button to do so, and
        its imports only read from QuickBooks and Jobber. You can disconnect either at any time, from
        C Stream or from inside that service.
      </p>

      <h2>Check what matters</h2>
      <p>
        C Stream helps you keep track of jobs, money and compliance, and it can be wrong. Its
        assistant can misread things. Check amounts, deadlines and documents before you rely on them,
        and before anything goes to a general contractor, a government agency or your books.
      </p>

      <h2>Use it fairly</h2>
      <p>
        Don&apos;t use C Stream to break the law, to get into another company&apos;s records, or to disrupt
        the service for others. We may suspend an account that does.
      </p>

      <h2>Changes</h2>
      <p>If these terms change, the date at the top changes with them.</p>
    </PublicDocument>
  );
}

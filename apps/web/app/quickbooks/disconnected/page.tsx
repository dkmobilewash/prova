import type { Metadata } from "next";
import { PublicDocument } from "@/components/PublicDocument";

/**
 * Intuit's "Disconnect URL": where someone lands after disconnecting
 * C Stream from inside QuickBooks (Apps → My apps). A static page, public,
 * because the person may not be signed in to C Stream at that moment.
 *
 * What it says is what the code does. Nothing here is told of the
 * disconnect; the next QuickBooks call fails to renew the access, and
 * lib/quickbooks-token.ts marks the connection NEEDS_REAUTH, which Settings
 * shows. Imported records and the account mapping are untouched.
 */

export const metadata: Metadata = { title: "QuickBooks disconnected — C Stream" };

export default function QuickBooksDisconnectedPage() {
  return (
    <PublicDocument title="QuickBooks is disconnected">
      <p>
        C Stream can no longer reach your QuickBooks Online company. Nothing more will be sent to
        QuickBooks or read from it.
      </p>
      <ul>
        <li>Nothing in QuickBooks was changed or removed by disconnecting.</li>
        <li>
          Clients, vendors and catalog entries you imported from QuickBooks stay in C Stream, and so do
          your invoices and your account mapping.
        </li>
      </ul>
      <p>
        To connect again, sign in to C Stream, open{" "}
        <a href="/settings" className="text-link hover:text-link-hover">
          Settings
        </a>
        , and in the QuickBooks Online section press Disconnect, then Connect QuickBooks.
      </p>
    </PublicDocument>
  );
}

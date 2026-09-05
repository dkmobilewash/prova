import type { ReactNode } from "react";
import type { IntegrationProvider } from "@prova/db";

/**
 * The one list of providers, and the seam the next phase hooks into.
 *
 * Adding a real integration should mean adding an entry here plus that
 * provider's own connect/sync code — never editing the Integrations page.
 * The page renders whatever this exports; it knows nothing about any
 * particular provider.
 *
 * WHY THIS IS NOT A BOOLEAN
 *
 * The obvious shape is `implemented: true | false`. It cannot describe the
 * state QuickBooks is actually in: built, shipped and verified against a
 * sandbox company, with its own connection row, account mapping and
 * append-only sync log in billing.prisma — but implemented BEFORE this
 * framework existed and not running on it. A boolean forces a choice
 * between claiming this framework runs QuickBooks, which it does not, and
 * labelling a working integration "coming soon", which is false on a page
 * whose whole job is telling an owner what is connected.
 *
 * So the state is a three-way discriminated union and the page renders each
 * case differently. The cost is one extra branch; the benefit is that no
 * card on that page can say something untrue.
 */
export type ProviderImplementation =
  /** This framework runs it: connect, disconnect and the sync log below. */
  | { kind: "builtin" }
  /**
   * Real and live, but it predates this framework and keeps its own tables.
   * The card reads status from those tables and links to where it is
   * managed, so there is exactly one answer to "is it connected?".
   */
  | { kind: "external"; href: string; managedAt: string }
  /** Not built. Renders disabled, with no control that implies otherwise. */
  | { kind: "planned" };

export type ProviderEntry = {
  provider: IntegrationProvider;
  name: string;
  description: string;
  icon: ReactNode;
  implementation: ProviderImplementation;
};

const iconClass = "h-5 w-5";

export const PROVIDERS: ProviderEntry[] = [
  {
    provider: "SANDBOX",
    name: "Sandbox",
    description:
      "A test connection to nothing. It exists so this page and its sync log can be exercised end to end without a real provider — connect and disconnect it freely.",
    implementation: { kind: "builtin" },
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M7 3v4.2a2 2 0 0 1-.3 1L3.5 13a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3l-3.2-4.8a2 2 0 0 1-.3-1V3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M6 3h8M6.5 11.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    provider: "QUICKBOOKS",
    name: "QuickBooks Online",
    description:
      "Invoices push to QuickBooks, the record is read back to confirm what landed, and reconciliation reports where the two disagree. One direction only — Prova does not pull QuickBooks edits back.",
    implementation: { kind: "external", href: "/settings", managedAt: "Settings" },
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className={iconClass} aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M12.2 7.6A3 3 0 0 0 7.4 9.7v.6a3 3 0 0 0 4.8 2.1M10 5.5v9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    provider: "DOCUSIGN",
    name: "DocuSign",
    description:
      "Send subcontracts and change orders for signature through DocuSign. Prova signs contracts with its own e-sign links today; this would cover every document type.",
    implementation: { kind: "planned" },
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M4 14.5c2.5.6 3.6-.7 3.6-2.4 0-1.3-.7-2-1.5-1.8-1.4.4-.9 3.3 1.3 4 1.7.6 3.4-.3 4.4-1.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13 5.5 15.5 8 10 13.5H7.5V11L13 5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    provider: "PROCORE",
    name: "Procore",
    description:
      "A read-only feed from a GC's Procore project, so drawings, RFIs and submittals arrive without being re-keyed. Read-only by intent: the GC's project is theirs, not ours to write to.",
    implementation: { kind: "planned" },
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className={iconClass} aria-hidden="true">
        <path d="M10 3.2 16.5 7v6L10 16.8 3.5 13V7L10 3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M10 9.6 16.5 7M10 9.6V16.8M10 9.6 3.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    provider: "MYCOI",
    name: "myCOI",
    description:
      "Certificate-of-insurance verification for vendors and subs, so an expired COI is caught before somebody is on site under it rather than after.",
    implementation: { kind: "planned" },
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className={iconClass} aria-hidden="true">
        <path d="M10 3.2 15.5 5.4v4.3c0 3-2.2 5.6-5.5 7-3.3-1.4-5.5-4-5.5-7V5.4L10 3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="m7.5 10 1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

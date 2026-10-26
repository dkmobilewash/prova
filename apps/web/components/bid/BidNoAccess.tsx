/**
 * Bid's "not part of your access" page. Not `components/NoAccess.tsx`, whose
 * one button goes to the CRM's /dashboard — the door Bid must not have. The
 * wording follows that component's: say the page exists, that nothing is
 * broken, and who can change it.
 */
export function BidNoAccess() {
  return (
    <div className="px-4 py-16 sm:px-6">
      <h1 className="mb-2 text-xl font-semibold text-ink">You&apos;re not set up to see this</h1>
      <p className="max-w-prose text-sm text-ink-body">
        C Stream Bid covers estimating and pricing, which isn&apos;t part of what you&apos;ve been set up to
        see. Nothing is broken and you haven&apos;t done anything wrong — the account owner decides who sees
        what.
      </p>
    </div>
  );
}

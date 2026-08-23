import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { disconnectQuickBooks } from "@/lib/actions";
import { QuickBooksTestConnectionButton } from "@/components/QuickBooksTestConnectionButton";

const QB_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You declined the QuickBooks connection request.",
  state_mismatch: "That connection attempt couldn't be verified — please try again.",
  missing_params: "QuickBooks didn't return the expected information — please try again.",
  token_exchange_failed: "QuickBooks rejected the connection — please try again.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qb?: string; qb_detail?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { qb, qb_detail } = await searchParams;

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Settings</h1>
        <p className="text-sm text-slate-400">Only the account owner can manage integrations.</p>
      </div>
    );
  }

  const connection = await prisma.quickBooksConnection.findUnique({
    where: { companyId: company.id },
    include: { connectedByUser: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Settings</h1>

      {qb === "connected" && (
        <p className="mb-6 rounded-md border border-green-900 bg-green-950/50 px-4 py-3 text-sm text-green-400">
          QuickBooks connected successfully.
        </p>
      )}
      {qb === "error" && (
        <p className="mb-6 rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {(qb_detail && QB_ERROR_MESSAGES[qb_detail]) ?? "Couldn't connect to QuickBooks — please try again."}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">QuickBooks Online</h2>
        <p className="mb-4 text-sm text-slate-400">
          Connects your QuickBooks Online company for accounting sync. This only establishes the
          connection today — jobs, contacts, and invoices aren&apos;t pushed to QuickBooks yet.
        </p>

        {connection ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-100">
              Connected
              {connection.connectedByUser && ` by ${connection.connectedByUser.name ?? connection.connectedByUser.email}`}
            </p>
            <p className="mb-4 text-xs text-slate-500">
              QuickBooks company ID: {connection.realmId} · connected{" "}
              {connection.createdAt.toLocaleDateString()}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <QuickBooksTestConnectionButton />
              <form action={disconnectQuickBooks}>
                <button type="submit" className="text-sm text-red-400 hover:underline">
                  Disconnect
                </button>
              </form>
            </div>
          </div>
        ) : (
          // A plain link (not next/link, so it's never hover-prefetched, and
          // not a Server Action form — see app/api/quickbooks/start/route.ts
          // for why this needs to be a real GET navigation).
          <a
            href="/api/quickbooks/start"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Connect QuickBooks
          </a>
        )}
      </section>
    </div>
  );
}

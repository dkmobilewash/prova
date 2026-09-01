import Link from "next/link";
import { prisma } from "@prova/db";
import { Card, StatusBadge } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { connectSandboxIntegration, disconnectSandboxIntegration } from "@/lib/actions";
import { IntegrationControls } from "@/components/IntegrationControls";
import { PROVIDERS, type ProviderEntry } from "@/lib/integrations/registry";
import { relativeTime } from "@/lib/integrations/relativeTime";
import { CONNECTION_CARD_SELECT } from "@/lib/integrations/selects";

/**
 * Settings → Integrations.
 *
 * The page renders whatever the registry exports and knows nothing about
 * any particular provider — that is the seam. Adding a real integration
 * means a registry entry plus that provider's own connect code, not an edit
 * here.
 *
 * WHY QUICKBOOKS IS NOT A "COMING SOON" CARD. It is built, shipped and
 * verified against a sandbox company, with its own connection, account
 * mapping and append-only sync log in billing.prisma. It predates this
 * framework and does not run on it. So its card reads its status from
 * QuickBooks' OWN table and links to where it is managed. Two rows able to
 * disagree about whether QuickBooks is connected is exactly the bug class
 * this codebase keeps finding, and a settings page whose job is telling an
 * owner what is connected is the worst possible place to introduce one.
 */

const SYNC_LOG_LIMIT = 10;

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink-body">{value}</dd>
    </div>
  );
}

export default async function IntegrationsPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  // The same gate the sibling Settings page uses, worded the same way. The
  // server actions assert it independently — hiding a control is not the
  // security boundary, it is the courtesy.
  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-ink">Integrations</h1>
        <p className="text-sm text-ink-body">Only the account owner can manage integrations.</p>
      </div>
    );
  }

  const [connections, quickBooks] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { companyId: company.id },
      // Named columns, not `include`. The encrypted envelopes are not in the
      // result at all, so no later edit can forward them to a client
      // component and into the RSC payload. See lib/integrations/selects.ts.
      select: {
        ...CONNECTION_CARD_SELECT,
        syncLogs: {
          orderBy: { occurredAt: "desc" },
          take: SYNC_LOG_LIMIT,
          select: { id: true, direction: true, status: true, message: true, occurredAt: true },
        },
      },
    }),
    // QuickBooks' own table is the single source of truth for that card.
    prisma.quickBooksConnection.findUnique({
      where: { companyId: company.id },
      // realmId, a date, and the connection's own health. Never the tokens:
      // QuickBooksConnection stores those as plain columns, so reading the
      // whole row into a page is exactly what not to do here.
      select: { realmId: true, createdAt: true, status: true, statusDetail: true },
    }),
  ]);

  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
  const now = new Date();

  function renderCard(entry: ProviderEntry) {
    const impl = entry.implementation;
    const planned = impl.kind === "planned";
    const connection = byProvider.get(entry.provider);

    // What the pill says, per implementation kind. QuickBooks answers from
    // its own row; the framework's providers answer from theirs; a planned
    // provider has no status because it has no connection to have one.
    // QuickBooks answers from its own row — including when that row says the
    // connection is broken. Until QuickBooksConnection.status existed this
    // could only say CONNECTED or NOT_CONNECTED, so a dead refresh token
    // read as perfectly healthy right up until someone tried to push.
    const status =
      impl.kind === "external"
        ? (quickBooks?.status ?? "NOT_CONNECTED")
        : (connection?.status ?? "NOT_CONNECTED");

    const isConnected = status === "CONNECTED";

    return (
      <Card
        key={entry.provider}
        // Reuses the nav rail's treatment for something that exists but
        // cannot be used yet, rather than inventing a second disabled style.
        className={planned ? "opacity-50" : ""}
        aria-disabled={planned || undefined}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-ink-label">{entry.icon}</span>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">{entry.name}</h2>
                {planned ? (
                  <span className="inline-flex items-center rounded-full bg-tag-slate px-2.5 py-0.5 text-xs font-medium text-tag-slate-ink">
                    Coming soon
                  </span>
                ) : (
                  <StatusBadge status={status} />
                )}
              </div>
              <p className="max-w-xl text-sm text-ink-body">{entry.description}</p>
            </div>
          </div>

          <div className="shrink-0">
            {impl.kind === "builtin" && (
              <IntegrationControls
                connected={isConnected}
                connect={connectSandboxIntegration}
                disconnect={disconnectSandboxIntegration}
                providerName={entry.name}
              />
            )}
            {impl.kind === "external" && (
              <Link
                href={impl.href}
                className="inline-flex items-center justify-center rounded-md border border-line-card bg-surface px-4 py-2 text-sm font-medium text-ink-label hover:bg-tag-slate"
              >
                Manage in {impl.managedAt}
              </Link>
            )}
          </div>
        </div>

        {impl.kind === "external" && quickBooks && (
          <dl className="mt-4 grid gap-4 border-t border-line-card pt-4 sm:grid-cols-3">
            <DetailRow label="Account" value={`Realm ${quickBooks.realmId}`} />
            <DetailRow label="Connected" value={relativeTime(quickBooks.createdAt, now)} />
            <DetailRow
              label="History"
              value="Push attempts are logged on the Settings page"
            />
            {quickBooks.statusDetail && (
              <div className="sm:col-span-3">
                <DetailRow label="Needs attention" value={quickBooks.statusDetail} />
              </div>
            )}
          </dl>
        )}

        {impl.kind === "builtin" && connection && isConnected && (
          <>
            <dl className="mt-4 grid gap-4 border-t border-line-card pt-4 sm:grid-cols-3">
              <DetailRow label="Account" value={connection.externalAccountLabel ?? "—"} />
              <DetailRow
                label="Last synced"
                value={connection.lastSyncedAt ? relativeTime(connection.lastSyncedAt, now) : "Never"}
              />
              <DetailRow
                label="Scopes"
                value={connection.scopes.length ? connection.scopes.join(", ") : "—"}
              />
            </dl>

            {connection.syncLogs.length > 0 && (
              <details className="mt-4 border-t border-line-card pt-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-label">
                  Recent activity ({connection.syncLogs.length})
                </summary>
                <ul className="mt-3 flex flex-col gap-2">
                  {connection.syncLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex flex-col gap-1 rounded-md border border-line-card px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3"
                    >
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                        {log.occurredAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                      </span>
                      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                        {log.direction.replace("_", " ")}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-medium ${
                          log.status === "SUCCESS" ? "text-tag-green-ink" : "text-tag-rose-ink"
                        }`}
                      >
                        {log.status === "SUCCESS" ? "Success" : "Failure"}
                      </span>
                      <span className="text-sm text-ink-body">{log.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <Link href="/settings" className="text-sm text-ink-body hover:text-ink">
          ← Settings
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">Integrations</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-body">
          Services this company connects to. Connecting one never gives it access to another
          company&rsquo;s data, and a credential is stored encrypted and never shown back here.
        </p>
      </div>

      <div className="flex flex-col gap-4">{PROVIDERS.map(renderCard)}</div>
    </div>
  );
}

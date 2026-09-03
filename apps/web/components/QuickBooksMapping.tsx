"use client";

import { useState, useTransition } from "react";
import {
  clearQuickBooksAccountMapping,
  loadQuickBooksAccounts,
  saveQuickBooksAccountMapping,
} from "@/lib/actions";
import { QUICKBOOKS_ACCOUNT_PURPOSES } from "@/lib/quickbooks-constants";

/**
 * Which QuickBooks account each kind of money posts to.
 *
 * Chosen by a person, never inferred. A contractor's accountant has
 * opinions about which account labor hits, and a platform that picks one
 * quietly is how books get corrupted in a way nobody notices until tax
 * time — which is precisely the "silently diverges" complaint that makes
 * accounting sync the most-hated feature in this market.
 *
 * The account list is fetched on demand rather than on page load: it is a
 * network round trip to Intuit, and most visits to Settings are not about
 * QuickBooks.
 */

// Imported rather than declared here. This list and the code that READS a
// mapping were two separate copies of the same fact, and they drifted: the
// job page looked up "INVOICE_REVENUE" while this said "INCOME", so Settings
// showed a mapping as present and the push path called it missing. One list,
// one truth.
const PURPOSES = QUICKBOOKS_ACCOUNT_PURPOSES;

type Account = { id: string; name: string; accountType: string; accountSubType?: string };
export type MappingRow = { purpose: string; qboAccountId: string; qboAccountName: string };

export function QuickBooksMapping({ mappings }: { mappings: MappingRow[] }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const current = new Map(mappings.map((m) => [m.purpose, m]));

  function load() {
    setError(null);
    startTransition(async () => {
      const result = await loadQuickBooksAccounts();
      if (result.ok) setAccounts(result.accounts);
      else setError(result.error);
    });
  }

  function save(purpose: string, formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveQuickBooksAccountMapping(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={load}
          disabled={isPending}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Loading…" : accounts ? "Reload accounts" : "Load accounts from QuickBooks"}
        </button>
        {error && <p className="text-xs text-rose-300">{error}</p>}
      </div>

      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
        {PURPOSES.map((purpose) => {
          const mapped = current.get(purpose.value);
          return (
            <li key={purpose.value} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">{purpose.label}</p>
                <p className="text-xs text-slate-400">{purpose.hint}</p>
              </div>

              {accounts === null ? (
                <p className="text-xs text-slate-400">
                  {mapped ? mapped.qboAccountName : "Not mapped"}
                </p>
              ) : (
                <form
                  action={(formData) => save(purpose.value, formData)}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="purpose" value={purpose.value} />
                  <select
                    name="qboAccountId"
                    defaultValue={mapped?.qboAccountId ?? ""}
                    onChange={(event) => {
                      const form = event.currentTarget.form;
                      const chosen = accounts.find((a) => a.id === event.currentTarget.value);
                      if (form && chosen) {
                        (form.elements.namedItem("qboAccountName") as HTMLInputElement).value =
                          chosen.name;
                      }
                    }}
                    className="max-w-[16rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="">— Choose an account —</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.accountType})
                      </option>
                    ))}
                  </select>
                  <input
                    type="hidden"
                    name="qboAccountName"
                    defaultValue={mapped?.qboAccountName ?? ""}
                  />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    Save
                  </button>
                  {mapped && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await clearQuickBooksAccountMapping(purpose.value);
                        })
                      }
                      className="text-xs text-slate-400 hover:text-rose-300 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type SyncAttemptRow = {
  id: string;
  entityType: string;
  outcome: string;
  summary: string;
  detail: string | null;
  createdAt: string;
};

const OUTCOME_TONE: Record<string, string> = {
  SUCCEEDED: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
  VERIFY_MISMATCH: "border-amber-800 bg-amber-950/40 text-amber-200",
  FAILED: "border-rose-800 bg-rose-950/40 text-rose-200",
  SKIPPED: "border-slate-700 bg-slate-900 text-slate-300",
};

const OUTCOME_LABEL: Record<string, string> = {
  SUCCEEDED: "Sent and verified",
  VERIFY_MISMATCH: "Sent, but QuickBooks holds something different",
  FAILED: "Refused by QuickBooks",
  SKIPPED: "Not sent",
};

/**
 * Every push attempt, including the ones that never left.
 *
 * A sync you cannot audit is one nobody trusts the moment two numbers
 * disagree — and "sent, but QuickBooks holds something different" is its
 * own outcome here rather than a success with a footnote, because that is
 * the exact state every competitor in the research reports as success.
 */
export function QuickBooksSyncLog({ attempts }: { attempts: SyncAttemptRow[] }) {
  if (attempts.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Nothing has been sent to QuickBooks yet. Every attempt will be recorded here — including
        the ones that fail, and the ones where what landed didn&apos;t match what was sent.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {attempts.map((attempt) => (
        <li
          key={attempt.id}
          className={`rounded-md border px-3 py-2 ${OUTCOME_TONE[attempt.outcome] ?? OUTCOME_TONE.SKIPPED}`}
        >
          <p className="text-xs font-medium">{OUTCOME_LABEL[attempt.outcome] ?? attempt.outcome}</p>
          <p className="mt-0.5 text-sm">{attempt.summary}</p>
          {attempt.detail && <p className="mt-0.5 text-xs opacity-90">{attempt.detail}</p>}
          <p className="mt-0.5 text-xs opacity-70">{attempt.createdAt}</p>
        </li>
      ))}
    </ul>
  );
}

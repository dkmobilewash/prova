"use client";

import { useState, useTransition } from "react";
import {
  addCompanyTradeScope,
  removeCompanyTradeScope,
  updateCompanyTradeScope,
} from "@/lib/actions";

/**
 * Which of the five WWCCA trade families this company self-performs.
 *
 * `CompanyTradeScope` was added on 24 Aug with a model, a migration and a
 * unique index, and had ZERO references anywhere in apps/web until this
 * component — while FEATURE-AUDIT sheet 01 marked "Trade-scope tags per
 * company" as Built the whole time. Third time in this file's neighbourhood:
 * the licence row and the union-affiliation row were both marked Built on
 * their models alone, and both were found the same way — by writing the
 * click-list and discovering step one was impossible.
 */

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing & drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

export type TradeScopeData = {
  id: string;
  tradeScope: string;
  isPrimary: boolean;
  /** Already an ISO date string, rendered in UTC by the server — the client
   * formatting a Date here is how the two sides end up disagreeing. */
  activeSince: string | null;
};

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-slate-400";

function scopeLabel(value: string) {
  return TRADE_SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * One field set for both the add form and the inline edit, so neither can
 * accept something the other refuses.
 *
 * `taken` is the scopes already on the list. They are left out of the
 * select because offering one of five options that is certain to be refused
 * is not a choice — but the server still refuses a duplicate, because this
 * filter is a convenience and the unique index is the actual rule.
 */
function TradeScopeFields({
  scope,
  taken,
}: {
  scope?: TradeScopeData;
  taken: string[];
}) {
  const options = TRADE_SCOPE_OPTIONS.filter(
    (o) => o.value === scope?.tradeScope || !taken.includes(o.value),
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Trade
        <select
          name="tradeScope"
          defaultValue={scope?.tradeScope ?? options[0]?.value}
          className={`w-56 ${inputClass}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Self-performing since (optional)
        <input
          type="date"
          name="activeSince"
          defaultValue={scope?.activeSince ?? ""}
          className={inputClass}
        />
      </label>

      {/* Not defaulted to today: nobody has said when this company started
          self-performing this trade, and stamping the date somebody happened
          to open the form is an invented fact on a compliance record. */}
      <label className="flex items-center gap-2 pb-2 text-xs text-slate-400">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={scope?.isPrimary ?? false}
          className="h-4 w-4"
        />
        Primary trade
      </label>
    </div>
  );
}

function TradeScopeRow({
  scope,
  taken,
  canManage,
}: {
  scope: TradeScopeData;
  taken: string[];
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpdate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCompanyTradeScope(scope.id, formData);
      if (result.ok) setIsEditing(false);
      else setError(result.error);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeCompanyTradeScope(scope.id);
      if (!result.ok) setError(result.error);
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form action={handleUpdate} className="flex flex-col gap-3">
          <TradeScopeFields scope={scope} taken={taken} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
            {error && <p className="text-sm text-rose-300">{error}</p>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-100">
          {scopeLabel(scope.tradeScope)}
          {scope.isPrimary && (
            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
              Primary
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {scope.activeSince ? `Self-performing since ${scope.activeSince}` : "Start date not recorded"}
        </p>
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setIsEditing(true);
              setIsConfirmingDelete(false);
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Edit
          </button>
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={handleRemove}
                className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function CompanyTradeScopes({
  scopes,
  canManage,
}: {
  scopes: TradeScopeData[];
  canManage: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const taken = scopes.map((scope) => scope.tradeScope);
  const allFiveHeld = taken.length >= TRADE_SCOPE_OPTIONS.length;

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addCompanyTradeScope(formData);
      if (result.ok) setIsAdding(false);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {scopes.length === 0 ? (
        <p className="text-sm text-slate-400">
          No trades tagged yet. Add the ones you self-perform — that is what tells this company
          apart from a GC who subcontracts the same scope out.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {scopes.map((scope) => (
            <TradeScopeRow key={scope.id} scope={scope} taken={taken} canManage={canManage} />
          ))}
        </ul>
      )}

      {canManage &&
        (isAdding ? (
          <form
            action={handleCreate}
            className="flex flex-col gap-3 rounded-lg border border-slate-800 p-4"
          >
            <TradeScopeFields taken={taken} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Adding…" : "Add trade"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsAdding(false);
                  setError(null);
                }}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
            </div>
          </form>
        ) : allFiveHeld ? (
          <p className="text-xs text-slate-500">
            All five trade scopes are on the list. Remove one to change it.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="self-start rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Add a trade
          </button>
        ))}

      {error && !isAdding && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
}

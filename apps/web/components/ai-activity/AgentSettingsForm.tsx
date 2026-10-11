"use client";

import { useRef, useState, useTransition } from "react";
import { saveAgentSettings } from "@/lib/actions/agentSettings";
import type { AgentSettings, AgentSpend } from "@/lib/agents/core";
import { Spinner } from "@/components/Spinner";
import { readSettingsForm, type SettingsErrors as Errors } from "@/components/ai-activity/settingsForm";

type Person = { id: string; name: string | null; email: string; role: string };

const SWITCHES = [
  { name: "watcherEnabled", label: "Bid watcher", hint: "Reads your bid invitations and flags what is due soon or changed." },
  { name: "researchOnNewBid", label: "Research", hint: "Researches a new bid when it is logged: your history with the GC, similar jobs, the documents." },
  { name: "checkerBeforeSend", label: "Estimate check", hint: "Checks an estimate against your own past prices and the addenda before it goes out." },
  { name: "recommendationsEnabled", label: "Recommendations", hint: "Bid-or-pass advice, learned from the wins and losses you record." },
] as const;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const FIELD =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base tabular-nums text-ink focus:border-link focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-70 sm:text-sm";

/**
 * The agents' switches, timing, spend cap and who hears about them.
 *
 * Owner-only to change — `saveAgentSettings` refuses anyone else — so a
 * non-owner sees the same values with every control disabled and a line
 * saying who can change them, rather than a form that can only come back
 * refused. Nothing here can send or change a bid; these only decide when
 * the agents read and who is told.
 */
export function AgentSettingsForm({
  settings,
  spend,
  people,
  schedule,
  isOwner,
}: {
  settings: AgentSettings;
  spend: AgentSpend;
  people: Person[];
  schedule: string;
  isOwner: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const on = SWITCHES.filter((s) => settings[s.name]).length;

  return (
    <form
      ref={formRef}
      noValidate
      data-agent-settings
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        const read = readSettingsForm(new FormData(event.currentTarget));
        if (!read.ok) {
          setErrors(read.errors);
          const first = read.errors.dueSoonDays ? "dueSoonDays" : "monthlySpendCapUsd";
          formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
          return;
        }
        setErrors({});
        startTransition(async () => {
          try {
            const res = await saveAgentSettings(read.input);
            if (!res.ok) return setErrors({ form: res.error });
            setSaved(true);
          } catch {
            setErrors({ form: "Couldn't save just now. Nothing was changed — try again." });
          }
        });
      }}
      className="min-w-0 rounded-2xl border border-line-card bg-surface px-5 pb-5 pt-4"
      aria-labelledby="ai-settings-heading"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ai-settings-heading" className="font-headline text-2xl text-ink">
          Settings
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{on} of 4 on</span>
      </div>
      {!isOwner && (
        <p className="mt-2 rounded-lg border border-line-card bg-canvas px-3 py-2 text-sm text-ink-body" data-read-only>
          Only the account owner can change these.
        </p>
      )}

      <fieldset disabled={!isOwner} className="mt-2 min-w-0">
        <legend className="sr-only">Agents</legend>
        <ul>
          {SWITCHES.map((s) => (
            <li key={s.name} className="border-t border-line-row first:border-t-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-4 py-3 has-[:disabled]:cursor-default">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{s.label}</span>
                  <span className="block text-sm text-ink-muted">
                    {s.name === "watcherEnabled" ? `${schedule}. ` : ""}
                    {s.hint}
                  </span>
                </span>
                <input type="checkbox" role="switch" name={s.name} defaultChecked={settings[s.name]} className="peer sr-only" />
                <span
                  aria-hidden
                  className="relative h-7 w-12 shrink-0 rounded-full bg-line-card transition-colors after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-ink-muted after:transition-transform peer-checked:bg-brand peer-checked:text-neutral-900 peer-checked:after:translate-x-5 peer-checked:after:bg-neutral-900 peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-disabled:opacity-70 motion-reduce:transition-none motion-reduce:after:transition-none"
                />
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-1 rounded-lg border border-line-card bg-canvas px-3 py-2 text-sm text-ink-body">
          Sending, submitting and changing a bid always wait for you. Agents only read and advise.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Flag bids due within
            <span className="flex items-center gap-2">
              <input
                name="dueSoonDays"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={String(settings.dueSoonDays)}
                aria-invalid={errors.dueSoonDays ? true : undefined}
                aria-describedby={errors.dueSoonDays ? "ai-days-error" : undefined}
                className={`${FIELD} w-20`}
              />
              <span className="text-ink-muted">days</span>
            </span>
            {errors.dueSoonDays && (
              <span id="ai-days-error" className="text-danger">
                {errors.dueSoonDays}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Monthly AI spend cap for agents
            <span className="flex items-center gap-2">
              <span className="text-ink-muted">$</span>
              <input
                name="monthlySpendCapUsd"
                inputMode="decimal"
                autoComplete="off"
                placeholder="No cap"
                defaultValue={settings.monthlySpendCapUsd === null ? "" : settings.monthlySpendCapUsd.toFixed(2)}
                aria-invalid={errors.monthlySpendCapUsd ? true : undefined}
                aria-describedby={`ai-spend-line${errors.monthlySpendCapUsd ? " ai-cap-error" : ""}`}
                className={`${FIELD} w-32`}
              />
            </span>
            <span id="ai-spend-line" className={spend.overCap ? "text-danger" : "text-ink-muted"} data-spend>
              {spend.capUsd === null
                ? `${usd(spend.usd)} this month · no cap set`
                : `${usd(spend.usd)} of ${usd(spend.capUsd)} this month${spend.overCap ? " — agents are paused until next month or a higher cap" : ""}`}
            </span>
            {errors.monthlySpendCapUsd && (
              <span id="ai-cap-error" className="text-danger">
                {errors.monthlySpendCapUsd}
              </span>
            )}
          </label>
        </div>

        <fieldset className="mt-5 min-w-0">
          <legend className="font-headline text-xl text-ink">Who hears about it</legend>
          {people.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Nobody else is on this account yet.</p>
          ) : (
            <ul className="mt-1">
              {people.map((p) => (
                <li key={p.id} className="border-t border-line-row first:border-t-0">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 has-[:disabled]:cursor-default">
                    <input
                      type="checkbox"
                      name="notifyUserIds"
                      value={p.id}
                      defaultChecked={settings.notifyUserIds.includes(p.id)}
                      className="h-5 w-5 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {p.name ?? p.email}
                      <span className="text-sm text-ink-muted"> · {p.role === "OWNER" ? "Owner" : p.role.charAt(0) + p.role.slice(1).toLowerCase().replace(/_/g, " ")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </fieldset>

      <div aria-live="polite" className="mt-4">
        {errors.form && (
          <p role="alert" className="rounded-md border border-line-card bg-tag-rose px-3 py-2 text-sm text-danger">
            {errors.form}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-ink-body">
            Saved.
          </p>
        )}
      </div>

      {isOwner && (
        <button
          type="submit"
          disabled={isPending}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Save settings"
          )}
        </button>
      )}
    </form>
  );
}

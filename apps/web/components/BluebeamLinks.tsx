"use client";

import { useRef, useState, useTransition } from "react";
import { linkJobToBluebeam, pushBluebeamDocument, refreshBluebeamSessionAction, unlinkBluebeamSession } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type BluebeamLinkRow = {
  id: string;
  jobId: string;
  jobName: string;
  bluebeamSessionName: string;
  lastSyncedLabel: string;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
};

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-60";
const select = "min-h-11 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink";

/**
 * A job's Bluebeam Studio Session: link a job (creates a fresh Session),
 * push a PDF into it, refresh its markup status, unlink. No "pick a
 * project" step like Procore/CompanyCam have — Bluebeam's API CREATES a
 * session, it does not list ones a company already has, so linking here
 * is a create rather than a pick.
 *
 * WHAT "REFRESH" ACTUALLY READS, stated on the card rather than assumed:
 * a file count and a markup STATUS count (how many are in which state).
 * Not quantities, not geometry — see packages/integrations/src/
 * bluebeam.ts for why that ceiling is Bluebeam's, not this app's.
 */
export function BluebeamLinks({ links, jobs }: { links: BluebeamLinkRow[]; jobs: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [linking, startLinking] = useTransition();
  const [working, startWorking] = useTransition();
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function link() {
    if (!jobId) {
      setError("Pick a job.");
      return;
    }
    const form = new FormData();
    form.set("jobId", jobId);
    setError(null);
    startLinking(async () => {
      const result = await linkJobToBluebeam(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setJobId("");
      setNotice("Linked. Push a PDF in, then Refresh to see how many markups the file has.");
    });
  }

  function pushFile(link: BluebeamLinkRow, file: File) {
    const form = new FormData();
    form.set("jobId", link.jobId);
    form.set("file", file);
    setError(null);
    setNotice(null);
    setPushingId(link.id);
    startWorking(async () => {
      const result = await pushBluebeamDocument(form);
      setPushingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(`Pushed "${file.name}" to ${link.bluebeamSessionName}.`);
    });
  }

  function refresh(link: BluebeamLinkRow) {
    setError(null);
    setNotice(null);
    setRefreshingId(link.id);
    startWorking(async () => {
      const result = await refreshBluebeamSessionAction(link.jobId);
      setRefreshingId(null);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-4 border-t border-line-card pt-4" data-tour="bluebeam-links">
      <h3 className="text-sm font-semibold text-ink">Linked jobs</h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-body">
        Link a job to create a Bluebeam Studio Session for it, push a PDF drawing set or spec section into that
        session, then Refresh to see how many markups have come back and their status. Nothing about the file is
        stored in C Stream — this is a straight hand-off into Bluebeam.
      </p>

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No job is linked to a Bluebeam Studio Session yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-row rounded-md border border-line-card">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">
                  {link.jobName} → {link.bluebeamSessionName}
                </span>
                <span className={`text-xs ${link.lastSyncOk === false ? "text-tag-rose-ink" : "text-ink-muted"}`}>
                  Last synced {link.lastSyncedLabel}
                  {link.lastSyncMessage ? ` — ${link.lastSyncMessage}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <input
                  ref={(el) => {
                    fileInputs.current[link.id] = el;
                  }}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) pushFile(link, file);
                  }}
                />
                <button
                  type="button"
                  className={quiet}
                  disabled={working}
                  onClick={() => fileInputs.current[link.id]?.click()}
                  data-tour="bluebeam-push"
                >
                  {working && pushingId === link.id ? "Pushing…" : "Push a PDF"}
                </button>
                <button
                  type="button"
                  className={quiet}
                  disabled={working}
                  onClick={() => refresh(link)}
                  data-tour="bluebeam-refresh"
                >
                  {working && refreshingId === link.id ? "Refreshing…" : "Refresh"}
                </button>
                <RowActions
                  className="flex items-center gap-2"
                  destructive={
                    <ConfirmDelete
                      describe="Removes the link only. Nothing in Bluebeam changes — the Studio Session and everything pushed to it stay exactly as they are."
                      label="Unlink"
                      confirmLabel="Confirm unlink"
                      pendingLabel="Unlinking…"
                      pending={working}
                      pinned="end"
                      onConfirm={() => {
                        setError(null);
                        startWorking(async () => {
                          const result = await unlinkBluebeamSession(link.id);
                          if (!result.ok) setError(result.error);
                        });
                      }}
                    />
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button type="button" className={`${quiet} mt-3`} onClick={() => setOpen(true)} data-tour="bluebeam-link">
          Link a job to a new Studio Session
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-line-card p-3" data-tour="bluebeam-link-form">
          {jobs.length === 0 ? (
            <p className="text-sm text-ink-body">Every job already has a Bluebeam Studio Session. Unlink one first, or add a job.</p>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-ink-label sm:max-w-xs">
              Job
              <select className={select} value={jobId} onChange={(event) => setJobId(event.target.value)}>
                <option value="">Pick one…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {jobs.length > 0 && (
              <button type="button" className={button} onClick={link} disabled={linking}>
                {linking ? "Linking…" : "Link"}
              </button>
            )}
            <button type="button" className={quiet} onClick={() => setOpen(false)} disabled={linking}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-tag-green-ink">
          {notice}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { linkAccProject, listAccProjectsForLinking, unlinkAccProject } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type ACCLinkRow = {
  id: string;
  jobName: string;
  accProjectName: string;
  accAccountName: string;
  lastRefreshedLabel: string;
  lastRefreshOk: boolean | null;
  lastRefreshMessage: string | null;
};

type Linkable = {
  id: string;
  name: string;
  problem: string | null;
  projects: { id: string; name: string }[];
};

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-60";
const select = "min-h-11 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink";

/**
 * Which ACC project feeds which job, on the ACC card. Same shape as
 * ProcoreLinks.tsx.
 *
 * The picker asks the server for the ACC accounts and projects this login
 * can see only when the owner opens it (an Autodesk call per account — not
 * something to spend on every page load). The server checks the chosen
 * project against Autodesk again when saving, so nothing typed or chosen
 * here is trusted about ACC.
 */
export function ACCLinks({ links, jobs }: { links: ACCLinkRow[]; jobs: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [unlinking, startUnlinking] = useTransition();
  const [accounts, setAccounts] = useState<Linkable[] | null>(null);
  const [choice, setChoice] = useState("");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openPicker() {
    setOpen(true);
    setError(null);
    setNotice(null);
    startLoading(async () => {
      const result = await listAccProjectsForLinking();
      if (!result.ok) {
        setError(result.error);
        setAccounts(null);
        return;
      }
      setAccounts(result.value);
    });
  }

  function save() {
    const [accAccountId, accProjectId] = choice.split(":");
    if (!accAccountId || !accProjectId || !jobId) {
      setError("Pick an ACC project and a job.");
      return;
    }
    const form = new FormData();
    form.set("accAccountId", accAccountId);
    form.set("accProjectId", accProjectId);
    form.set("jobId", jobId);
    setError(null);
    startSaving(async () => {
      const result = await linkAccProject(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setChoice("");
      setJobId("");
      setNotice("Linked. The GC's RFIs and submittals now show on that job's pages.");
    });
  }

  const pickable = (accounts ?? []).filter((a) => a.projects.length > 0);
  const blocked = (accounts ?? []).filter((a) => a.problem);

  return (
    <div className="mt-4 border-t border-line-card pt-4" data-tour="acc-links">
      <h3 className="text-sm font-semibold text-ink">Linked projects</h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-body">
        Link a GC&rsquo;s Autodesk Construction Cloud project to your job. Its RFIs and submittals then
        show on your RFIs and Submittals pages, marked as the GC&rsquo;s, with a link back to ACC. They
        are never added to your own RFI or submittal log.
      </p>

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No ACC project is linked to a job yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-row rounded-md border border-line-card">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">
                  {link.accProjectName} <span className="text-ink-muted">({link.accAccountName})</span> →{" "}
                  {link.jobName}
                </span>
                <span className={`text-xs ${link.lastRefreshOk === false ? "text-tag-rose-ink" : "text-ink-muted"}`}>
                  Last read {link.lastRefreshedLabel}
                  {link.lastRefreshMessage ? ` — ${link.lastRefreshMessage}` : ""}
                </span>
              </div>
              <RowActions
                className="flex shrink-0 items-center gap-2"
                destructive={
                  <ConfirmDelete
                    describe="Stops showing this project's GC records on the job. Nothing changes in ACC."
                    label="Unlink"
                    confirmLabel="Confirm unlink"
                    pendingLabel="Unlinking…"
                    pending={unlinking}
                    pinned="end"
                    onConfirm={() => {
                      setError(null);
                      startUnlinking(async () => {
                        const result = await unlinkAccProject(link.id);
                        if (!result.ok) setError(result.error);
                      });
                    }}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button type="button" className={`${quiet} mt-3`} onClick={openPicker} data-tour="acc-link">
          Link an ACC project to a job
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-line-card p-3" data-tour="acc-link-form">
          {loading && <p className="text-sm text-ink-muted">Asking Autodesk which projects you can see…</p>}
          {!loading && accounts && pickable.length === 0 && (
            <p className="text-sm text-ink-body">
              Your ACC login can&rsquo;t see any projects C Stream is allowed to read yet.
            </p>
          )}
          {!loading && blocked.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-ink-muted">
              {blocked.map((account) => (
                <li key={account.id}>
                  <span className="font-medium text-ink-label">{account.name}:</span> {account.problem}
                </li>
              ))}
            </ul>
          )}
          {!loading && pickable.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                ACC project
                <select className={select} value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">Pick one…</option>
                  {pickable.map((account) => (
                    <optgroup key={account.id} label={account.name}>
                      {account.projects.map((project) => (
                        <option key={project.id} value={`${account.id}:${project.id}`}>
                          {project.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Your job
                <select className={select} value={jobId} onChange={(event) => setJobId(event.target.value)}>
                  <option value="">Pick one…</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {!loading && pickable.length > 0 && jobs.length === 0 && (
            <p className="text-sm text-ink-body">Every job already has an ACC project. Unlink one first, or add a job.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {pickable.length > 0 && (
              <button type="button" className={button} onClick={save} disabled={saving || loading}>
                {saving ? "Linking and reading…" : "Link"}
              </button>
            )}
            <button type="button" className={quiet} onClick={() => setOpen(false)} disabled={saving}>
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

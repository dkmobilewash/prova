"use client";

import { useState, useTransition } from "react";
import { linkProcoreProject, listProcoreProjectsForLinking, unlinkProcoreProject } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type ProcoreLinkRow = {
  id: string;
  jobName: string;
  procoreProjectName: string;
  procoreCompanyName: string;
  lastRefreshedLabel: string;
  lastRefreshOk: boolean | null;
  lastRefreshMessage: string | null;
};

type Linkable = {
  id: string;
  name: string;
  problem: string | null;
  projects: { id: string; name: string; number: string | null }[];
};

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-60";
const select = "min-h-11 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink";

/**
 * Which Procore project feeds which job, on the Procore card.
 *
 * The picker asks the server for the Procore companies and projects this
 * login can see only when the owner opens it (a Procore call per company —
 * not something to spend on every page load). The server checks the chosen
 * project against Procore again when saving, so nothing typed or chosen
 * here is trusted about Procore.
 */
export function ProcoreLinks({ links, jobs }: { links: ProcoreLinkRow[]; jobs: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [unlinking, startUnlinking] = useTransition();
  const [companies, setCompanies] = useState<Linkable[] | null>(null);
  const [choice, setChoice] = useState("");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openPicker() {
    setOpen(true);
    setError(null);
    setNotice(null);
    startLoading(async () => {
      const result = await listProcoreProjectsForLinking();
      if (!result.ok) {
        setError(result.error);
        setCompanies(null);
        return;
      }
      setCompanies(result.value);
    });
  }

  function save() {
    const [procoreCompanyId, procoreProjectId] = choice.split(":");
    if (!procoreCompanyId || !procoreProjectId || !jobId) {
      setError("Pick a Procore project and a job.");
      return;
    }
    const form = new FormData();
    form.set("procoreCompanyId", procoreCompanyId);
    form.set("procoreProjectId", procoreProjectId);
    form.set("jobId", jobId);
    setError(null);
    startSaving(async () => {
      const result = await linkProcoreProject(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setChoice("");
      setJobId("");
      setNotice("Linked. The GC's drawings, RFIs and submittals now show on that job's pages.");
    });
  }

  const pickable = (companies ?? []).filter((c) => c.projects.length > 0);
  const blocked = (companies ?? []).filter((c) => c.problem);

  return (
    <div className="mt-4 border-t border-line-card pt-4" data-tour="procore-links">
      <h3 className="text-sm font-semibold text-ink">Linked projects</h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-body">
        Link a GC&rsquo;s Procore project to your job. Its drawings, RFIs and submittals then show on your
        Drawings, RFIs and Submittals pages, marked as the GC&rsquo;s, with a link back to Procore. They are
        never added to your own RFI or submittal log.
      </p>

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No Procore project is linked to a job yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-row rounded-md border border-line-card">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">
                  {link.procoreProjectName} <span className="text-ink-muted">({link.procoreCompanyName})</span> →{" "}
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
                    describe="Stops showing this project's GC records on the job. Nothing changes in Procore."
                    label="Unlink"
                    confirmLabel="Confirm unlink"
                    pendingLabel="Unlinking…"
                    pending={unlinking}
                    pinned="end"
                    onConfirm={() => {
                      setError(null);
                      startUnlinking(async () => {
                        const result = await unlinkProcoreProject(link.id);
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
        <button type="button" className={`${quiet} mt-3`} onClick={openPicker} data-tour="procore-link">
          Link a Procore project to a job
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-line-card p-3" data-tour="procore-link-form">
          {loading && <p className="text-sm text-ink-muted">Asking Procore which projects you can see…</p>}
          {!loading && companies && pickable.length === 0 && (
            <p className="text-sm text-ink-body">
              Your Procore login can&rsquo;t see any projects C Stream is allowed to read yet.
            </p>
          )}
          {!loading && blocked.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-ink-muted">
              {blocked.map((company) => (
                <li key={company.id}>
                  <span className="font-medium text-ink-label">{company.name}:</span> {company.problem}
                </li>
              ))}
            </ul>
          )}
          {!loading && pickable.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Procore project
                <select className={select} value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">Pick one…</option>
                  {pickable.map((company) => (
                    <optgroup key={company.id} label={company.name}>
                      {company.projects.map((project) => (
                        <option key={project.id} value={`${company.id}:${project.id}`}>
                          {project.number ? `${project.number} — ${project.name}` : project.name}
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
            <p className="text-sm text-ink-body">Every job already has a Procore project. Unlink one first, or add a job.</p>
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

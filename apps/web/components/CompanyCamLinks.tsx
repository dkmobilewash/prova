"use client";

import { useState, useTransition } from "react";
import {
  importCompanyCamPhotos,
  linkCompanyCamProject,
  listCompanyCamProjectsForLinking,
  unlinkCompanyCamProject,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type CompanyCamLinkRow = {
  id: string;
  jobName: string;
  companycamProjectName: string;
  lastImportedLabel: string;
  lastImportOk: boolean | null;
  lastImportMessage: string | null;
};

type PickerProject = { id: string; name: string; address: string | null };

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-60";
const select = "min-h-11 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink";

/**
 * Which CompanyCam project imports into which job, on the CompanyCam card
 * — the ProcoreLinks shape, plus the one control Procore doesn't have:
 * "Import photos", the press that actually pulls a batch.
 *
 * The picker asks the server for the projects this account can see only
 * when the owner opens it. The server checks the chosen project against
 * CompanyCam again when saving, so nothing chosen here is trusted.
 */
export function CompanyCamLinks({ links, jobs }: { links: CompanyCamLinkRow[]; jobs: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [working, startWorking] = useTransition();
  const [projects, setProjects] = useState<PickerProject[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [jobId, setJobId] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openPicker() {
    setOpen(true);
    setError(null);
    setNotice(null);
    startLoading(async () => {
      const result = await listCompanyCamProjectsForLinking();
      if (!result.ok) {
        setError(result.error);
        setProjects(null);
        return;
      }
      setProjects(result.value.projects);
      setTruncated(result.value.truncated);
    });
  }

  function save() {
    if (!projectId || !jobId) {
      setError("Pick a CompanyCam project and a job.");
      return;
    }
    const form = new FormData();
    form.set("companycamProjectId", projectId);
    form.set("jobId", jobId);
    setError(null);
    startSaving(async () => {
      const result = await linkCompanyCamProject(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setProjectId("");
      setJobId("");
      setNotice("Linked. Press Import photos to pull the project's photos into the job's gallery.");
    });
  }

  function runImport(linkId: string) {
    setError(null);
    setNotice(null);
    setImportingId(linkId);
    startWorking(async () => {
      const result = await importCompanyCamPhotos(linkId);
      setImportingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.value.message);
    });
  }

  return (
    <div className="mt-4 border-t border-line-card pt-4" data-tour="companycam-links">
      <h3 className="text-sm font-semibold text-ink">Linked projects</h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-body">
        Link a CompanyCam project to your job, then press Import photos. Each photo lands in the
        job&rsquo;s own gallery — captioned with its CompanyCam description, filed under the day it was
        taken, and marked as imported. Importing again only brings photos that aren&rsquo;t here yet.
      </p>

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No CompanyCam project is linked to a job yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-row rounded-md border border-line-card">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">
                  {link.companycamProjectName} → {link.jobName}
                </span>
                <span className={`text-xs ${link.lastImportOk === false ? "text-tag-rose-ink" : "text-ink-muted"}`}>
                  Last import {link.lastImportedLabel}
                  {link.lastImportMessage ? ` — ${link.lastImportMessage}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className={quiet}
                  disabled={working}
                  onClick={() => runImport(link.id)}
                  data-tour="companycam-import"
                >
                  {working && importingId === link.id ? "Importing…" : "Import photos"}
                </button>
                <RowActions
                  className="flex items-center gap-2"
                  destructive={
                    <ConfirmDelete
                      describe="Removes the link only. Photos already imported stay in the job's gallery, and nothing changes in CompanyCam."
                      label="Unlink"
                      confirmLabel="Confirm unlink"
                      pendingLabel="Unlinking…"
                      pending={working}
                      pinned="end"
                      onConfirm={() => {
                        setError(null);
                        startWorking(async () => {
                          const result = await unlinkCompanyCamProject(link.id);
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
        <button type="button" className={`${quiet} mt-3`} onClick={openPicker} data-tour="companycam-link">
          Link a CompanyCam project to a job
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-line-card p-3" data-tour="companycam-link-form">
          {loading && <p className="text-sm text-ink-muted">Asking CompanyCam which projects you can see…</p>}
          {!loading && projects && projects.length === 0 && (
            <p className="text-sm text-ink-body">Your CompanyCam account has no active projects to link.</p>
          )}
          {!loading && projects && projects.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                CompanyCam project
                <select className={select} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Pick one…</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.address ? `${project.name} — ${project.address}` : project.name}
                    </option>
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
          {!loading && truncated && (
            <p className="text-xs text-ink-muted">
              CompanyCam has more projects than this list shows (the first 500 are here).
            </p>
          )}
          {!loading && projects && projects.length > 0 && jobs.length === 0 && (
            <p className="text-sm text-ink-body">
              Every job already has a CompanyCam project. Unlink one first, or add a job.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {projects && projects.length > 0 && (
              <button type="button" className={button} onClick={save} disabled={saving || loading}>
                {saving ? "Linking…" : "Link"}
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

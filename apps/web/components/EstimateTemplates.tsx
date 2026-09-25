"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteEstimateTemplate,
  deleteEstimateTemplateItem,
  saveEstimateTemplate,
  saveEstimateTemplateItem,
} from "@/lib/actions";
import { quantityFor, type TemplateItemInput } from "@/lib/estimate-templates";

/**
 * The template library — company reference data, edited on /catalog beside
 * the catalog it points at.
 *
 * WHAT THIS SCREEN DOES NOT OFFER: a "refresh from template" on an estimate.
 * See lib/estimate-templates.ts — a template is a starting point, and a
 * refresh would silently overwrite the estimator's own edits.
 */

export type TemplateRow = {
  id: string;
  name: string;
  tradeScope: string | null;
  description: string | null;
  items: (TemplateItemInput & { catalogEntryDescription: string | null })[];
};

const TRADE_OPTIONS = [
  { value: "", label: "Any trade" },
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

const inputClass = "rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body";
const labelClass = "flex flex-col gap-1 text-xs text-ink-label";
const ghostButton =
  "rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800";

export function EstimateTemplates({
  templates,
  catalogEntries,
}: {
  templates: TemplateRow[];
  catalogEntries: { id: string; description: string; unit: string | null }[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const run = (work: () => Promise<{ ok: boolean; error?: string } | void>) => {
    setRowError(null);
    startTransition(async () => {
      const result = await work();
      if (result && !result.ok) setRowError(result.error ?? "That didn't go through. Reload the page.");
    });
  };

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-ink">Estimate templates</h2>
      <p className="mt-1 text-sm text-ink-body">
        The shape of a job you bid over and over. Save the lines once, then add them all to an
        ESTIMATE-stage job in one press from its estimate tab — instead of pulling each one out of
        the catalog by hand.
      </p>

      {templates.length === 0 && !adding ? (
        <button type="button" onClick={() => setAdding(true)} className={`mt-3 ${ghostButton}`}>
          Create a template
        </button>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line-row rounded-md border border-line-row bg-surface-card">
          {templates.map((template) => (
            <li key={template.id} className="p-3">
              {editing === template.id ? (
                <TemplateForm template={template} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-body">
                      <span className="font-medium text-ink">{template.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {template.items.length} line{template.items.length === 1 ? "" : "s"}
                      </span>
                      {template.tradeScope && (
                        <span className="ml-2 text-xs text-ink-muted">
                          {TRADE_OPTIONS.find((t) => t.value === template.tradeScope)?.label ?? template.tradeScope}
                        </span>
                      )}
                    </p>
                    {template.description && (
                      <p className="mt-1 text-xs text-ink-muted">{template.description}</p>
                    )}
                    {template.items.length === 0 && (
                      <p className="mt-1 text-xs text-tag-amber-ink">
                        No lines on it yet — it will not add anything until you put some on.
                      </p>
                    )}
                  </div>

                  <RowActions
                    className="flex shrink-0 items-center gap-2"
                    destructive={
                      <ConfirmDelete
                        label="Delete"
                        describe={`Removes the “${template.name}” template. Estimates already built from it keep their lines.`}
                        confirmLabel="Confirm delete"
                        pendingLabel="Deleting…"
                        pending={isPending}
                        pinned="end"
                        onConfirm={() => run(() => deleteEstimateTemplate(template.id))}
                      />
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setOpenItems(openItems === template.id ? null : template.id)}
                      className={ghostButton}
                    >
                      {openItems === template.id ? "Hide lines" : "Lines"}
                    </button>
                    <button type="button" onClick={() => setEditing(template.id)} className={ghostButton}>
                      Edit
                    </button>
                  </RowActions>
                </div>
              )}

              {openItems === template.id && (
                <TemplateItems
                  template={template}
                  catalogEntries={catalogEntries}
                  pending={isPending}
                  onRun={run}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {rowError && (
        <p role="alert" className="mt-2 text-sm text-tag-rose-ink">
          {rowError}
        </p>
      )}

      {adding ? (
        <div className="mt-3 rounded-md border border-line-row bg-surface-card p-3">
          <TemplateForm template={null} onDone={() => setAdding(false)} />
        </div>
      ) : (
        templates.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} className={`mt-3 ${ghostButton}`}>
            Create another template
          </button>
        )
      )}
    </section>
  );
}

function TemplateForm({ template, onDone }: { template: TemplateRow | null; onDone: () => void }) {
  return (
    <ActionForm action={saveEstimateTemplate} className="flex flex-wrap items-start gap-2" onSuccess={onDone}>
      {template && <input type="hidden" name="templateId" value={template.id} />}

      <label className={labelClass}>
        Name
        <input
          name="name"
          defaultValue={template?.name ?? ""}
          placeholder="TI, metal stud + drywall"
          className={`w-56 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Trade
        <select name="tradeScope" defaultValue={template?.tradeScope ?? ""} className={`w-48 ${inputClass}`}>
          {TRADE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        When to reach for it
        <input
          name="description"
          defaultValue={template?.description ?? ""}
          placeholder="Standard office TI, level 3 finish"
          className={`w-64 ${inputClass}`}
        />
      </label>

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {template ? "Save" : "Create template"}
      </SubmitButton>
      <button type="button" onClick={onDone} className={`mt-4 ${ghostButton}`}>
        Cancel
      </button>
    </ActionForm>
  );
}

function TemplateItems({
  template,
  catalogEntries,
  pending,
  onRun,
}: {
  template: TemplateRow;
  catalogEntries: { id: string; description: string; unit: string | null }[];
  pending: boolean;
  onRun: (work: () => Promise<{ ok: boolean; error?: string } | void>) => void;
}) {
  const [addingItem, setAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  return (
    <div className="mt-3 border-t border-line-row pt-3">
      {template.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-row">
          {template.items.map((item) =>
            editingItem === item.id ? (
              <li key={item.id} className="py-2">
                <TemplateItemForm
                  templateId={template.id}
                  item={item}
                  catalogEntries={catalogEntries}
                  onDone={() => setEditingItem(null)}
                />
              </li>
            ) : (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink-body">
                    <span className="text-ink">{item.description}</span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {/* What the line will START at — the same number the
                          writer will use, from the same function, so the
                          screen cannot disagree with what gets written. */}
                      {quantityFor(item.defaultQuantity)}
                      {item.unit ? ` ${item.unit}` : ""}
                      {item.defaultQuantity === null && " — takeoff decides"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {item.catalogEntryDescription
                      ? `Priced from catalog: ${item.catalogEntryDescription}`
                      : "No catalog entry — the line arrives unpriced."}
                  </p>
                </div>

                <RowActions
                  className="flex shrink-0 items-center gap-2"
                  destructive={
                    <ConfirmDelete
                      label="Delete"
                      describe={`Removes “${item.description}” from this template.`}
                      confirmLabel="Confirm delete"
                      pendingLabel="Deleting…"
                      pending={pending}
                      pinned="end"
                      onConfirm={() => onRun(() => deleteEstimateTemplateItem(item.id))}
                    />
                  }
                >
                  <button type="button" onClick={() => setEditingItem(item.id)} className={ghostButton}>
                    Edit
                  </button>
                </RowActions>
              </li>
            ),
          )}
        </ul>
      )}

      {addingItem ? (
        <div className="mt-2">
          <TemplateItemForm
            templateId={template.id}
            item={null}
            catalogEntries={catalogEntries}
            onDone={() => setAddingItem(false)}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAddingItem(true)} className={`mt-2 ${ghostButton}`}>
          Add a line
        </button>
      )}
    </div>
  );
}

function TemplateItemForm({
  templateId,
  item,
  catalogEntries,
  onDone,
}: {
  templateId: string;
  item: (TemplateItemInput & { catalogEntryDescription: string | null }) | null;
  catalogEntries: { id: string; description: string; unit: string | null }[];
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={saveEstimateTemplateItem.bind(null, templateId)}
      className="flex flex-wrap items-start gap-2"
      onSuccess={onDone}
    >
      {item && <input type="hidden" name="itemId" value={item.id} />}

      <label className={labelClass}>
        Line
        <input
          name="description"
          defaultValue={item?.description ?? ""}
          placeholder="5/8 Type X, hung and finished"
          className={`w-56 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Unit
        <input name="unit" defaultValue={item?.unit ?? ""} placeholder="SF" className={`w-20 ${inputClass}`} />
      </label>

      <label className={labelClass}>
        Default quantity
        <input
          name="defaultQuantity"
          inputMode="decimal"
          defaultValue={item?.defaultQuantity?.toString() ?? ""}
          placeholder="blank"
          className={`w-28 ${inputClass}`}
        />
        <span className="text-ink-muted">Blank lets the takeoff decide — the line starts at 1.</span>
      </label>

      <label className={labelClass}>
        Priced from
        <select name="catalogEntryId" defaultValue={item?.catalogEntryId ?? ""} className={`w-56 ${inputClass}`}>
          <option value="">no catalog entry — arrives unpriced</option>
          {catalogEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.description}
              {entry.unit ? ` (${entry.unit})` : ""}
            </option>
          ))}
        </select>
      </label>

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {item ? "Save" : "Add line"}
      </SubmitButton>
      <button type="button" onClick={onDone} className={`mt-4 ${ghostButton}`}>
        Cancel
      </button>
    </ActionForm>
  );
}

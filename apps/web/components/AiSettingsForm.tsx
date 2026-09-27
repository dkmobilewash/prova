"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveCompanyAiSettings } from "@/lib/actions";
import { AI_FEATURE_DESCRIPTION, AI_FEATURE_KEYS, AI_FEATURE_LABEL } from "@/lib/ai/features";

/**
 * What AI is allowed to do for this company — the first thing on
 * /settings/assistant that writes.
 *
 * WHY IT IS A SCREEN AND NOT A SUPPORT REQUEST. Until this shipped, the only
 * gates on AI were a server-wide API key, per-person capabilities, rate limits
 * and a paid allowance — so a contractor who wanted their drawings kept away
 * from a model had no answer, and we had no way to give them one short of
 * turning the assistant off for everybody. A setting only we can change is not
 * their setting.
 *
 * EVERY FEATURE IS LISTED, INCLUDING THE ONE THAT DOES NOT EXIST YET, and that
 * is a correctness requirement rather than a preference: a checkbox that is off
 * posts nothing, so `saveCompanyAiSettings` reads absence as "switched off"
 * across every key it knows. Render six boxes for seven features and the
 * seventh is disabled every time anybody saves — silently, and for good. So the
 * list is derived from `AI_FEATURE_KEYS` and cannot fall behind the enum.
 *
 * `planSheetsPerMonth` is deliberately not on this form. It is what the
 * company's plan includes, not a preference, and an input for it would let an
 * owner raise their own paid allowance — the action refuses to read it for the
 * same reason.
 */

export type AiSettingsView = {
  aiEnabled: boolean;
  disabledFeatures: string[];
  modelOverride: string | null;
  planSheetsPerMonth: number;
};

/** The models an owner may pick, with what each one means to them.
 *
 * Plain English rather than model ids: "claude-haiku-4-5" tells a drywall
 * contractor nothing, and the id is our routing decision. The empty value is
 * the normal case and is listed first so the default reads as a choice rather
 * than as a blank. */
const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Recommended (we choose per feature)" },
  { value: "claude-opus-5", label: "Most capable, on everything" },
  { value: "claude-haiku-4-5", label: "Fastest and cheapest, on everything" },
];

export function AiSettingsForm({ settings }: { settings: AiSettingsView }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Held in state only so the per-feature boxes can be visibly greyed while the
  // master switch is off. It changes nothing about what is POSTED — the action
  // stores both, so turning AI back on restores exactly the per-feature choices
  // this company had before, rather than silently re-enabling everything.
  const [aiEnabled, setAiEnabled] = useState(settings.aiEnabled);

  const disabled = new Set(settings.disabledFeatures);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveCompanyAiSettings(formData);
      if (!result.ok) return setError(result.error);
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex min-h-[48px] items-center gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="aiEnabled"
          checked={aiEnabled}
          onChange={(event) => setAiEnabled(event.currentTarget.checked)}
          className="h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link"
        />
        <span>
          <span className="font-medium">Use AI in C Stream</span>
          <span className="block text-xs text-ink-body">
            Off means no document, drawing, question or figure from this company is sent to a model, by
            anyone, anywhere in the app.
          </span>
        </span>
      </label>

      <fieldset className="flex flex-col gap-3 border-t border-line-card pt-3">
        <legend className="sr-only">Which AI features are on</legend>
        <p className="text-xs text-ink-body">
          {aiEnabled
            ? "Or switch off just the parts you don't want. Anything left on works as before."
            : "These are kept as they are while AI is off, so turning it back on restores your choices."}
        </p>
        {AI_FEATURE_KEYS.map((feature) => (
          <label
            key={feature}
            className={`flex min-h-[48px] items-start gap-3 text-sm ${aiEnabled ? "text-ink" : "text-ink-muted"}`}
          >
            <input
              type="checkbox"
              name={`feature:${feature}`}
              defaultChecked={!disabled.has(feature)}
              disabled={!aiEnabled}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-card bg-canvas text-link focus:ring-link disabled:opacity-50"
            />
            <span>
              <span className="font-medium">{AI_FEATURE_LABEL[feature]}</span>
              <span className="block text-xs text-ink-body">{AI_FEATURE_DESCRIPTION[feature]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 border-t border-line-card pt-3 text-xs text-ink-label">
        Which model to use
        <select
          name="modelOverride"
          defaultValue={settings.modelOverride ?? ""}
          className="min-h-[48px] rounded-md border border-line-card bg-canvas px-2 text-sm text-ink focus:border-link focus:outline-none sm:w-96"
        >
          {MODEL_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <span className="text-ink-body">
          Leave this on Recommended unless C Stream has asked you to change it.
        </span>
      </label>

      {/* DELIBERATE MUTATION — DO NOT MERGE. The hidden inputs that carry the
          per-feature choices through a save-while-disabled are removed here to
          prove `e2e/specs/ai-switch.spec.ts` step 3 can see the data-loss bug.
          Restored in the next commit. If you are reading this on a merged
          commit, the switch is a trap: turning AI off wipes every per-feature
          choice, and turning it back on leaves all seven features refusing
          individually. */}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-[48px] rounded-md bg-neutral-800 px-4 text-sm font-medium text-ink hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save AI settings"}
        </button>
        {error && <p className="text-sm text-tag-amber-ink">{error}</p>}
        {saved && !error && (
          <p className="text-sm text-ink-body">Saved. This takes effect on the next question or upload.</p>
        )}
      </div>
    </form>
  );
}

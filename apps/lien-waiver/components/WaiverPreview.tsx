import { fillable } from "@/lib/statutes/forms";
import { printRuns, segmentForm, type Fills } from "@/lib/statutes/render";
import type { BuiltForm, ParagraphRole } from "@/lib/statutes/types";

/**
 * The form on screen, from the same `printRuns` the PDF is drawn from, so
 * what a person reads here is character for character what prints.
 */
const ROLE: Record<ParagraphRole, string> = {
  title: "text-base font-bold mt-3",
  notice: "font-bold mt-2",
  heading: "font-bold mt-3",
  caption: "text-xs text-quiet pl-8 -mt-1",
  body: "mt-2",
};

export function WaiverPreview({ form, fills }: { form: BuiltForm; fills: Fills }) {
  const paragraphs = segmentForm(form);
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-line bg-paper p-4 font-serif text-[15px] leading-relaxed text-ink shadow-sm">
      {paragraphs.map((paragraph) => (
        <p key={paragraph.index} className={`${ROLE[paragraph.role]} break-words`}>
          {printRuns(paragraph, fills, fillable).map((run, i) =>
            run.filled ? (
              <span key={i} className="bg-brand/40 underline decoration-2 underline-offset-2">
                {run.text}
              </span>
            ) : (
              <span key={i}>{run.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

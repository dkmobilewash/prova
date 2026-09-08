import { JOB_MEDIA_TAG_DATALIST_ID } from "@/lib/job-media-tags";

/**
 * The company's tag vocabulary, offered as suggestions to every tag input
 * on the page.
 *
 * THIS IS THE POINT OF THE VOCABULARY TABLE, not a nicety on top of it. A
 * free-text tag field with no suggestions gets "west wall", "West wall",
 * "w wall" and "westwall" from four people in a week — and while
 * `normalizeTagName` folds the first two together, nothing can fold the
 * last two, because they are genuinely different strings that a human
 * meant as one thing. The only fix for that is to show people the words
 * they already have before they invent another one.
 *
 * A plain `<datalist>` rather than a JavaScript combobox, deliberately.
 * It is one element, it needs no state, it works before hydration, and on
 * a phone the browser renders it as the native suggestion strip above the
 * keyboard — which is the surface a person on a jobsite is actually
 * looking at. A hand-rolled dropdown would have to reimplement keyboard
 * handling, dismissal and scroll-into-view to be worse than this.
 *
 * RENDERED ONCE PER PAGE, not once per card: `<input list="…">` resolves
 * its id against the whole document, so 60 cards share this one element
 * instead of shipping the same 50 options 60 times. The cost of that
 * sharing is a page that renders cards and forgets this component, where
 * the inputs simply have no suggestions and nothing says so — so both
 * galleries render it from inside the section component that owns them,
 * where forgetting it is not a thing a caller can do.
 *
 * A server component. It has no interactivity of its own, and keeping it
 * off the client means the option list is markup rather than props threaded
 * through every card.
 */
export function JobMediaTagDatalist({ names }: { names: string[] }) {
  return (
    <datalist id={JOB_MEDIA_TAG_DATALIST_ID}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

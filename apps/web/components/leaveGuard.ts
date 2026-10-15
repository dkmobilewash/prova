/**
 * "You have unsaved changes" — one guard for every dirty ActionForm on the
 * page, so two half-filled forms ask once, not twice.
 *
 * Two exits are covered: closing/reloading the tab (`beforeunload`, which
 * shows the browser's own prompt) and clicking an in-app link, which never
 * fires `beforeunload` because Next navigates client-side. The click is
 * caught in the CAPTURE phase on `document`, before React's root listener
 * runs `<Link>`'s handler, and stopped there if the person stays.
 *
 * Listeners exist only while something is dirty — nothing is attached on a
 * page where nobody has typed.
 *
 * ponytail: the browser Back button (popstate) is not covered; Next gives no
 * cancellable hook for it. Drafts (`draftKey`) are what protect that path.
 */
const dirty = new Set<object>();

export const LEAVE_PROMPT = "You have unsaved changes on this page. Leave without saving them?";

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Still required by some browsers for the prompt to appear.
  event.returnValue = "";
}

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // new tab/window
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
  const to = new URL(link.href, window.location.href);
  // Another site is a full page load, which `beforeunload` already covers.
  if (to.origin !== window.location.origin) return;
  if (to.pathname === window.location.pathname && to.search === window.location.search) return;
  if (window.confirm(LEAVE_PROMPT)) {
    // They chose to go; don't ask a second time on the way out.
    dirty.clear();
    sync();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function sync() {
  if (dirty.size > 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
  } else {
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("click", onClick, true);
  }
}

/** Mark a form (any stable object) as holding unsaved edits, or not. */
export function setUnsaved(owner: object, unsaved: boolean) {
  if (unsaved) dirty.add(owner);
  else dirty.delete(owner);
  sync();
}

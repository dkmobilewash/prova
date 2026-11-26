### The Undo toast survives deleting a job's last plan

**Found by #1268's own production proof (ZZ job, 2026-11-26).** Deleting the job's only plan refreshed the takeoff tab
into its "No drawing on this job yet" branch. That branch did not render the plan-deleted toast, so the toast unmounted
with its Undo, and the one way back did not exist on the commonest job there is. The delete itself was correct
throughout: the dialog's numbers, the estimate drop and the 10-minute window.

**The fix:** `<PlanDeletedToast />` is now the first child of the page's `<section>` in both returns. That is the one
position both share, so React keeps the same instance, with its message and Undo, across the refresh.

**Checks:** `planDeletedToastMount.test.tsx` holds both halves.
- **A census of the page:** the toast is first in every return, and appears nowhere else. It was red on main.
- **The real toast in a real React root:** it keeps its message and Undo when everything after it changes. This half
  is there because a census can prove the code is present, never that React keeps it.

Three mutations, all red: the no-plan branch without the toast, the toast after the header, and a third copy.

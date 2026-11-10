### With plan reading off, the Scale step asks for the floor plans (Diego)
`diego/scale-step-floors`

With plan reading off and plan comparison off, nothing names a sheet, so the plan set had no
floor plan. "Confirm scales" saved the sheets the scale reader was sure of; on Baker that
included the ceiling plan A111 and three structural sheets. The step then called itself done
with A100 and A101 unscaled, and Run takeoff was off on every floor plan. Now the page
inventory, which reads every page's text anyway and calls no model, records which pages are
surely floor plans: an architectural sheet whose title or drawing caption says FLOOR PLAN,
and not another trade's. Those pages are the Scale step's floor plans when nothing else names
them, each with its printed-scale fix. With no whole-set run, the workspace opens on the
first one that has a scale. "Sure" no longer counts a caption that merely says PLAN, which
had taken Baker's code, foundation and communications plans. Checked on Baker
(`takeoff-scale-floor-plans.local.spec.ts`): A100 and A101 are listed, the printed scale on
A101 sets it, and Run takeoff there is on. Mutation: with the record unread, step 2 fails.

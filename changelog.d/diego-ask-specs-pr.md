### Ask answers questions about a job's spec, with the section or sheet for every item

**New read-only Ask tool, `spec_requirements`.** It answers from the job's spec reads: a spec book's sections and the Division 09/07 notes printed on its drawings, through the same loader the Specs page and the "spec says" notes use. Examples:
- "What board does the spec call for on Baker?"
- "Does Hutto need Level 5 anywhere?"
- "What stud gauge is specified?"
- "Any spec items not in my estimate?"

**How it answers:**
- Every item comes back with its source, e.g. `09 21 16`, or `09 22 16, sheet A100` for a drawing's note, and its quote.
- The lightest gauge allowed, the widest spacing and whether Level 5 appears anywhere are worked out by code, never by the model.
- **"Not in my estimate"** matches the price items (Type X, abuse board, Level 5, heavier studs, deflection track, attic stock…) against the estimate's line descriptions. It says it matched by words: a line under another name is not seen, and nothing here knows what anything costs.
- A job with nothing read is pointed to its Specs page.
- It needs estimating access, the same as the Specs page.

**Twelve eval cases** cover the four questions, three phrasings each. **They are not run yet: the eval key is out of credit.**

**The "spec says" notes now list each stated stud gauge heavier than 25 ga** on its own. A section stating 20 ga walls and 25 ga struts used to say nothing about studs.

The drawing-spec false-hit changes first written here moved to their own PR (drawing specs round 3), so this one waits on its routing eval alone.

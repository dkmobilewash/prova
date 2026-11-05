### The wall-type measurement now counts what the WALLS stage would post, including walls typed by thickness alone (Diego)
`diego/wall-types-measure`

`realplan/wallTypes.eval.ts` used to count every tagged group as typed. The
WALLS stage does not: `wallItems.ts` posts a tag only where the library has
that type, a U.N.O. note only where it is the one type that thick, and an
untagged group by thickness alone where exactly one library type is that
thick (`ONLY_ONE_THAT_THICK`, labelled "(by thickness)"). The eval now uses
that same rule, so it reports four sources (tag, carried, note,
schedule-thickness), the untyped remainder, and the footage of tags the
drawing printed that name no type in the library (posted untyped today).

It also writes `<set>__p<page>.runs.json` per sheet: every run's endpoints in
page-width units, length, thickness, the type it would be posted as (or null)
and the source, which is what a scorecard against a typed answer key needs.
A cached model legend read with a sight read beside it is merged as the
proposal is and given the add-from-legend thickness, and `WT_SHEETS_FILE`
takes the sheet list from a file. Measurement only; nothing in the product
changes.

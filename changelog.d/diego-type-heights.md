### Wall heights per partition type, behind TAKEOFF_TYPE_HEIGHTS (off by default)

With the flag on, a wall takes its height from its own partition type before today's chain. The rule comes from the type's own legend lines: a fixed height (inch fractions kept), N" above the ceiling, to the ceiling, to a soffit, to deck, a plate height, a partial height, or no board (masonry with no gypsum). An untyped wall takes the plan's rule for untyped walls.
- "N above" and "to the ceiling" use the higher ceiling of the rooms on either side.
- A to-deck wall takes the elevation the structural drawings print (H4'): top of steel, joist or truss bearing, bottom of deck, eave and ridge, less the floor's stated elevation. Framing plans are laid over the sheet by level, each value rules near where it's printed, a value marked U.N.O. rules elsewhere, and under a sloped roof the height runs from eave to ridge.
- What the documents leave open is priced at the company's assumed answer and labelled "needs answer: …". A no-board type prices no board.

Measured once on heights-key-r20 V2, training only: pooled board height error $164,498 → $122,805, no set worse by the pre-registered bar. The whole gain is one set (114026). Only 4% of key wall footage lies on a run that carries a type code at zero touch, so most walls still fall through to today's chain. Pre-registration and numbers: coordination/prereg-type-heights.md, type-heights-r1/.

### Zero-touch's key side prices zoned heights: by sheet, by room zone, by the type's scalar

The heights key stopped being one scalar per type and the eval caught up (Diego's order after the
room-sides run): `keyWallFeet` prices each key wall from its type's SHEET zone (Hutto's levels),
else its ROOM zone through the set's zone key (`wallKeyHeight`, the #1198 mechanism; ZT_ZONE_KEYS
names the coordination/*-room-parts-key.md files), else the type's own scalar, else the default —
and the default/unresolved walls still feed the ZTBOARD worklist. `loadKeyTypes` keeps the flat
loader's rules (uppercased keys, sameAs chains to 5 hops), and `keyTypeFor`'s exact-first spelling
join means Hutto D6/E6/C6 price at their levels through key D/E/C. Parity ran on 3 sheets as
ordered (committed instrument zzKeyZonesParity.eval.ts): Hutto A101 39 walls @ 12.156 ft, A102 101
walls @ 10.156 ft, Joplin A-101 91 zoned walls wall-for-wall identical to the zzZonedHeights-style
direct path, 70 room-zone resolved. The ZT KEYZONES instrument line prints the per-arm counts in
both groups. Unit tests cover the arm order, the join, sameAs chains, case, disagreeing rooms and
the Joplin-K array-zone fallthrough.

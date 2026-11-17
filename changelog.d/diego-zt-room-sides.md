Zero-touch prices each run wall's board at its own rooms' height, through the product's probe
(`wallChainWithRooms`, one shared function for `assignWallHeights` and the eval), instead of one
set-level chain height per sheet (#1157's "no room sides"). A wall beside no room falls through the
same chain to the same answer as before, so the change is a strict refinement; the ROOMSIDES
instrument line prints rooms found, walls priced and heights moved, in both groups. The census test
pins the shared call on both sides and reds if either grows a private copy — mutation-tested both
ways (M1 old one-height line back in the eval, M2 a private probe loop back in the product: each 1
failed; clean 4 passed). Closes the eval half of the #1188 room-sides gap that priced Joplin A
(1,033 ft) and OReillys S21 (304 ft) room-zone walls at the set default; the key-side zoned pricing
(wallKeyHeight through the zone keys) is the named follow-up, not in this PR.

### Accept all is on the toolbar's Undo stack

Chrome on Baker: after "Accept all suggestions on this sheet" the toolbar Undo
stayed grey; only the inline Undo link took it back. Accept all (and "on all N
groups nothing names") now goes on the same Undo stack as the one-group accepts:
Undo takes every group back, Redo accepts them again with a fresh undo. The inline
link and the toolbar share one record, so whichever is pressed first, the other
has nothing left to undo.

-- AlterTable: "Count like this" becomes an OFF switch so it can be ON for
-- every company without an UPDATE over customer rows — the grey-out's
-- pattern (20261030000000_demoted_walls_off). Additive, NOT NULL with a
-- DEFAULT, so every existing row gets false, which means ON, for free.
--
-- "symbolCountOn" is deliberately NOT dropped here: the deploy that stops
-- reading it must be live before the drop (CLAUDE.md, #378). Its own PR.
ALTER TABLE "Company" ADD COLUMN "symbolCountOff" BOOLEAN NOT NULL DEFAULT false;

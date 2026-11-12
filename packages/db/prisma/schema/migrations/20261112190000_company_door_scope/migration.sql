-- Who installs the doors and frames a set shows (Company.doorScope). Additive: one enum, one column with a
-- default, so every existing company reads BY_OTHERS — no line for a door — exactly what it has today.
-- CreateEnum
CREATE TYPE "DoorScope" AS ENUM ('BY_OTHERS', 'FRAMES', 'DOORS_AND_FRAMES');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "doorScope" "DoorScope" NOT NULL DEFAULT 'BY_OTHERS';

-- CreateEnum
CREATE TYPE "JobFunction" AS ENUM ('EXECUTIVE', 'ESTIMATOR', 'PROJECT_MANAGER', 'FIELD', 'PAYROLL_COMPLIANCE', 'ACCOUNTING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "jobFunction" "JobFunction";

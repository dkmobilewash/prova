import { prisma } from "@prova/db";
import type { EquipmentRateRow, EquipmentRateUnit } from "@/lib/equipment-rates";

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export function equipmentRateRow(row: {
  id: string;
  name: string;
  unit: EquipmentRateUnit;
  rate: { toString(): string };
  effectiveFrom: Date;
  effectiveTo: Date | null;
  notes: string | null;
}): EquipmentRateRow {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    rate: Number(row.rate),
    effectiveFrom: dayOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? dayOf(row.effectiveTo) : null,
    notes: row.notes,
  };
}

export async function loadEquipmentRates(companyId: string): Promise<EquipmentRateRow[]> {
  return (await prisma.equipmentRate.findMany({ where: { companyId } })).map(equipmentRateRow);
}

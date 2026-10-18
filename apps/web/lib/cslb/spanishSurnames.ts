/**
 * A ROUGH INSTRUMENT FOR ONE DECISION: does the call list need a Spanish
 * opener. The playbook's rule is "count surnames on your own list before
 * deciding"; this is that count. It is the sixty most common Hispanic
 * surnames in the US (Census 2010 surname tables, >75% Hispanic
 * self-identification), matched exactly on the owner's last name.
 *
 * It is not an ethnicity classifier and the page that shows the share says
 * so. A surname is not a language; it is a prior. The number it produces is
 * for deciding whether to say "¿prefiere español?" in the first sentence, and
 * nothing else reads it.
 */
export const COMMON_SPANISH_SURNAMES: ReadonlySet<string> = new Set([
  "garcia", "rodriguez", "martinez", "hernandez", "lopez", "gonzalez", "perez", "sanchez",
  "ramirez", "torres", "flores", "rivera", "gomez", "diaz", "cruz", "reyes", "morales",
  "ortiz", "gutierrez", "chavez", "ramos", "ruiz", "alvarez", "mendoza", "vasquez",
  "castillo", "jimenez", "moreno", "romero", "herrera", "medina", "aguilar", "garza",
  "castro", "vargas", "fernandez", "guzman", "munoz", "mendez", "salazar", "soto",
  "delgado", "pena", "rios", "alvarado", "sandoval", "contreras", "valdez", "guerrero",
  "ortega", "estrada", "nunez", "maldonado", "vega", "vazquez", "santiago", "dominguez",
  "espinoza", "silva", "padilla",
]);

/** The last word of `First Last`, lower-cased, accents stripped. */
export function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function isCommonSpanishSurname(name: string): boolean {
  return COMMON_SPANISH_SURNAMES.has(surnameOf(name));
}

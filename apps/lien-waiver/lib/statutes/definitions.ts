import { ARIZONA } from "./states/arizona";
import { CALIFORNIA } from "./states/california";
import { NEVADA } from "./states/nevada";
import { TEXAS } from "./states/texas";
import type { FormDefinition } from "./types";

/** Every statutory form this tool can print, as definitions. Build-time
 * only: the app imports the derived forms from generated/forms.json. */
export const DEFINITIONS: FormDefinition[] = [...ARIZONA, ...CALIFORNIA, ...NEVADA, ...TEXAS];

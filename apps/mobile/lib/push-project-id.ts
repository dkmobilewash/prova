/**
 * Where the EAS project id lives, which is two places depending on how
 * the app was built.
 *
 * `expo-constants` exposes it as `expoConfig.extra.eas.projectId` for a
 * normal build and as `easConfig.projectId` in some EAS contexts, and
 * either can be missing in a bare or misconfigured one. Push
 * registration needs it: `getExpoPushTokenAsync` throws without an id,
 * and it is called fire-and-forget at launch, so the throw is swallowed
 * and push simply never works with nothing said about why.
 *
 * Pure, and takes the constants object, so both shapes are testable
 * without a device.
 */
type ConstantsLike = {
  expoConfig?: { extra?: { eas?: { projectId?: unknown } } } | null;
  easConfig?: { projectId?: unknown } | null;
};

export function expoProjectId(constants: ConstantsLike): string | null {
  const fromConfig = constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig.trim();

  const fromEas = constants.easConfig?.projectId;
  if (typeof fromEas === "string" && fromEas.trim()) return fromEas.trim();

  return null;
}

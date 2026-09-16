import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuid } from "./id";

const KEY = "prova.clientId";

/** The device id sent as `clientId` on every mobile write. Generated once
 * on first use and persisted, so retries and later edits carry the same
 * identity. Null for web writes (the web action never sets it). */
export async function getClientId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;
  const id = uuid();
  await AsyncStorage.setItem(KEY, id);
  return id;
}

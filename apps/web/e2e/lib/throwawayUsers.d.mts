// Type surface for throwawayUsers.mjs, which the daily sweep runs with plain Node.
import type { ClerkClient } from "@clerk/backend";
export function throwawayEmail(prefix: string): string;
export function isThrowaway(email: string | null | undefined): boolean;
export function testClerk(secretKey?: string): ClerkClient;
export function deleteThrowaway(email: string, clerk?: ClerkClient): Promise<number>;
export function staleThrowaways<T extends { createdAt: number; emailAddresses?: { emailAddress: string }[] }>(users: T[], now: number, maxAgeMs?: number): T[];
export function sweepThrowaways(clerk: ClerkClient, now?: number, maxAgeMs?: number): Promise<{ total: number; deleted: number }>;

import { z } from "zod";
import type { Profile } from "./contracts.js";
import type { Limits } from "./ledger.js";
const SafeInt = z.number().int().positive().max(1_000_000_000_000);
export const ProfileSchema = z
  .object({
    model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
    reasoning: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,31}$/)
      .optional(),
    maxOutputTokens: SafeInt.max(16384),
    inputMicrousdPerMillion: SafeInt,
    outputMicrousdPerMillion: SafeInt,
    priceVersion: z.string().min(1).max(100),
  })
  .strict();
const ConfigSchema = z
  .object({
    profiles: z.record(
      z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      ProfileSchema,
    ),
    limits: z
      .object({
        dailyMicrousd: SafeInt,
        monthlyMicrousd: SafeInt,
        requestMicrousd: SafeInt,
        maxConcurrent: SafeInt.max(10),
        dailyRequests: SafeInt.max(10000),
      })
      .strict(),
    hostname: z.string().min(1).max(253),
  })
  .strict();
export interface Config {
  profiles: Record<string, Profile>;
  limits: Limits;
  hostname: string;
}
export function parseConfig(value: string): Config {
  return ConfigSchema.parse(JSON.parse(value));
}

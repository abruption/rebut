import { z } from "zod";
import type { Profile } from "./contracts.js";
import type { Limits } from "./ledger.js";
const SafeInt = z.number().int().positive().max(1_000_000_000_000);
const DailySpend = z.number().int().nonnegative().max(1_000_000_000_000);
export const LOCAL_BUDGET_ENV = "REBUT_LOCAL_BUDGET_LIMITS";
const extendedOutputModel = {
  openai: "gpt-6.2-astra",
  anthropic: "claude-fable-5-2",
};
export const ProfileSchema = z
  .object({
    provider: z.enum(["openai", "anthropic"]).optional(),
    model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
    reasoning: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,31}$/)
      .optional(),
    maxOutputTokens: SafeInt.max(50_000),
    inputMicrousdPerMillion: SafeInt,
    outputMicrousdPerMillion: SafeInt,
    priceVersion: z.string().min(1).max(100),
  })
  .strict()
  .refine(
    (p) =>
      p.provider !== "anthropic" ||
      p.reasoning === undefined ||
      ["low", "medium", "high", "xhigh", "max"].includes(p.reasoning),
    "Unsupported Anthropic effort",
  )
  .refine(
    (p) =>
      p.maxOutputTokens <= 16_384 ||
      p.model === extendedOutputModel[p.provider ?? "openai"],
    {
      path: ["maxOutputTokens"],
      message: "This model supports up to 16,384 output tokens in Rebut.",
    },
  );
export const LimitsSchema = z
  .object({
    dailyMicrousd: DailySpend,
    monthlyMicrousd: SafeInt,
    requestMicrousd: SafeInt,
    maxConcurrent: SafeInt.max(10),
    dailyRequests: SafeInt.max(10000),
  })
  .strict();
const SpendOverridesSchema = LimitsSchema.pick({
  dailyMicrousd: true,
  monthlyMicrousd: true,
})
  .partial()
  .strict();
const ConfigSchema = z
  .object({
    profiles: z.record(
      z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      ProfileSchema,
    ),
    limits: LimitsSchema,
    hostname: z.string().min(1).max(253),
  })
  .strict();
export interface Config {
  profiles: Record<string, Profile>;
  limits: Limits;
  hostname: string;
}
export function parseConfig(value: string, spendOverrides?: string): Config {
  const config = ConfigSchema.parse(JSON.parse(value));
  if (spendOverrides !== undefined)
    config.limits = applySpendOverrides(config.limits, spendOverrides);
  return config;
}

export function applySpendOverrides(limits: Limits, value: string): Limits {
  const overrides = SpendOverridesSchema.parse(JSON.parse(value));
  return { ...limits, ...overrides };
}

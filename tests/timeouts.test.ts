import { expect, it } from "vitest";
import {
  PROVIDER_TIMEOUT_MS,
  CLIENT_TOOL_TIMEOUT_MS,
  CODEX_TOOL_TIMEOUT_SECONDS,
} from "../src/timeouts.js";

it("keeps the requested 30-minute provider bound below every outer deadline", () => {
  expect(PROVIDER_TIMEOUT_MS).toBe(1_800_000);
  expect(CLIENT_TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(
    PROVIDER_TIMEOUT_MS + 30_000,
  );
  expect(CODEX_TOOL_TIMEOUT_SECONDS * 1000).toBeGreaterThanOrEqual(
    CLIENT_TOOL_TIMEOUT_MS + 30_000,
  );
  expect(PROVIDER_TIMEOUT_MS).toBeLessThan(2 ** 31 - 1);
});

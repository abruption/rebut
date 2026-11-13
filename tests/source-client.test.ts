import { afterEach, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../src/client/connection.js", () => ({
  connectRemote: remote.connect,
}));
import { main } from "../scripts/client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  remote.connect.mockReset();
});

it("uses the shared connection and preserves a result beyond the old 65-second deadline", async () => {
  vi.useFakeTimers();
  vi.stubEnv("REBUT_ENDPOINT", "https://example.invalid/mcp");
  vi.stubEnv("REBUT_TOKEN", "synthetic-token");
  const result = { content: [{ type: "text", text: "delayed metadata" }] };
  const client = {
    callTool: vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(result), 66_000)),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
  remote.connect.mockResolvedValue(client);
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const pending = main(["status", "original-id"]);
  await vi.advanceTimersByTimeAsync(66_000);
  await pending;
  const options = remote.connect.mock.calls[0][0];
  expect(options.endpoint).toBe("https://example.invalid/mcp");
  expect(await options.loadToken()).toBe("synthetic-token");
  expect(client.callTool).toHaveBeenCalledExactlyOnceWith({
    name: "review_status",
    arguments: { request_id: "original-id" },
  });
  expect(output).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + "\n");
  expect(client.close).toHaveBeenCalledOnce();
});

it("closes the shared transport on failure without retrying a paid call", async () => {
  vi.stubEnv("REBUT_ENDPOINT", "https://example.invalid/mcp");
  vi.stubEnv("REBUT_TOKEN", "synthetic-token");
  const client = {
    callTool: vi.fn().mockRejectedValue(new Error("synthetic failure")),
    close: vi.fn().mockResolvedValue(undefined),
  };
  remote.connect.mockResolvedValue(client);
  await expect(main(["status", "original-id"])).rejects.toThrow(
    "synthetic failure",
  );
  expect(client.callTool).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
});

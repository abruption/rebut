import { Agent } from "undici";
import { CLIENT_TOOL_TIMEOUT_MS } from "../timeouts.js";

/** Shared Node transport for Worker bridging and local provider execution. */
export function createNodeHttpTransport() {
  const dispatcher = new Agent({
    headersTimeout: CLIENT_TOOL_TIMEOUT_MS,
    bodyTimeout: CLIENT_TOOL_TIMEOUT_MS,
  });
  let closing: Promise<void> | undefined;
  const fetcher: typeof fetch = (input, init) => {
    const requestInit: RequestInit & { dispatcher: Agent } = {
      ...init,
      dispatcher,
    };
    return globalThis.fetch(input, requestInit);
  };
  return { fetch: fetcher, close: () => (closing ??= dispatcher.destroy()) };
}

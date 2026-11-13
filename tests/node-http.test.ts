import { createServer } from "node:http";
import { expect, it } from "vitest";
import { createNodeHttpTransport } from "../src/client/http.js";
it("executes the shared provider/bridge transport over a real loopback socket", async () => {
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        method: request.method,
        body: Buffer.concat(chunks).toString(),
        authorization: request.headers.authorization,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing fixture address");
  const transport = createNodeHttpTransport();
  try {
    const result = await transport.fetch(
      `http://127.0.0.1:${address.port}/synthetic`,
      {
        method: "POST",
        headers: { authorization: "Bearer synthetic-loopback-key" },
        body: "synthetic body",
      },
    );
    expect(await result.json()).toEqual({
      method: "POST",
      body: "synthetic body",
      authorization: "Bearer synthetic-loopback-key",
    });
    expect(calls).toBe(1);
  } finally {
    await transport.close();
    await transport.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

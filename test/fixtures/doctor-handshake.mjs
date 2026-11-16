// Test-only preload: observe the real in-memory MCP initialization, not a mocked Client.
import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { Agent } from "undici";

const connect = McpServer.prototype.connect;
McpServer.prototype.connect = function (transport) {
  const initialized = this.server.oninitialized;
  this.server.oninitialized = () => {
    writeFileSync(
      process.env.REBUT_TEST_HANDSHAKE,
      JSON.stringify(this.server.getClientVersion()),
    );
    initialized?.();
  };
  return connect.call(this, transport);
};
// Guard the fetch/undici paths used by Rebut; record even caught attempts.
const networkMarker = process.env.REBUT_TEST_HANDSHAKE + ".network";
let attempts = 0;
writeFileSync(networkMarker, "0");
const forbiddenNetwork = () => {
  writeFileSync(networkMarker, String(++attempts));
  throw new Error("Network is forbidden in the doctor handshake fixture");
};
globalThis.fetch = forbiddenNetwork;
Agent.prototype.dispatch = forbiddenNetwork;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-ctl-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;
// Never launch a real app from the test suite.
process.env.EXCALIDRAW_APP = "true";

const { requestOpen, OPEN_REQUEST_FILE } = await import("./control.js");
const requestPath = join(dir, OPEN_REQUEST_FILE);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("writes a request naming the drawing", async () => {
  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  await requestOpen("Auth flow");
  assert.deepEqual(JSON.parse(readFileSync(requestPath, "utf8")).name, "Auth flow");
});

test("the request file is dot-prefixed so it stays out of the sidebar", () => {
  assert.ok(OPEN_REQUEST_FILE.startsWith("."));
});

test("switch mode still writes the request", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "switch";
  await requestOpen("Auth flow");
  assert.ok(existsSync(requestPath));
});

test("off mode writes nothing", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "off";
  await requestOpen("Auth flow");
  assert.equal(existsSync(requestPath), false);
});

test("a launcher failure never throws", async () => {
  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  process.env.EXCALIDRAW_APP = "definitely-not-a-real-command-xyz";
  await requestOpen("Auth flow"); // must resolve, not reject
  process.env.EXCALIDRAW_APP = "true";
});

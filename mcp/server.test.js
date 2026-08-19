import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-srv-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;
process.env.EXCALIDRAW_MCP_FOCUS = "off"; // never launch an app from tests

const { createServer } = await import("./server.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const json = (result) => JSON.parse(result.content[0].text);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("exposes every tool", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "delete_drawing", "describe_scene", "draw", "edit",
    "list_drawings", "open_drawing", "rename_drawing",
  ]);
});

test("draw creates a drawing and reports the name used", async () => {
  const client = await connect();
  const out = json(await client.callTool({
    name: "draw",
    arguments: { name: "Stack", nodes: ["X", "Y", "Z"] },
  }));
  assert.equal(out.name, "Stack");
  assert.equal(out.elements, 6); // 3 boxes + 3 labels

  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.ok(list.some((d) => d.name === "Stack"));
});

test("draw with replace overwrites rather than duplicating", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Replaced", nodes: ["A"] } });
  await client.callTool({ name: "draw", arguments: { name: "Replaced", nodes: ["A", "B"] } });
  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.equal(list.filter((d) => d.name.startsWith("Replaced")).length, 1);
  const scene = json(await client.callTool({
    name: "describe_scene",
    arguments: { name: "Replaced" },
  }));
  assert.equal(scene.filter((e) => e.type === "rectangle").length, 2);
});

test("draw with append keeps what was already there", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Grown", nodes: ["A"] } });
  await client.callTool({
    name: "draw",
    arguments: { name: "Grown", nodes: ["B"], mode: "append" },
  });
  const scene = json(await client.callTool({
    name: "describe_scene",
    arguments: { name: "Grown" },
  }));
  assert.equal(scene.filter((e) => e.type === "rectangle").length, 2);
});

test("append places new content clear of the old", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Below", nodes: ["A"] } });
  const before = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Below" },
  }));
  const bottom = Math.max(...before.map((e) => e.y + e.height));
  await client.callTool({
    name: "draw", arguments: { name: "Below", nodes: ["B"], mode: "append" },
  });
  const after = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Below" },
  }));
  const added = after.find((e) => e.text === "B");
  assert.ok(added.y >= bottom, "appended content sits below existing content");
});

test("edit moves an element by id", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Movable", nodes: ["A"] } });
  const [box] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Movable" },
  }));
  await client.callTool({
    name: "edit",
    arguments: { name: "Movable", move: [{ id: box.id, x: 500, y: 600 }] },
  });
  const [moved] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Movable" },
  }));
  assert.equal(moved.x, 500);
  assert.equal(moved.y, 600);
});

test("edit recolours and retexts an element", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Paint", nodes: ["A"] } });
  const [box] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Paint" },
  }));
  await client.callTool({
    name: "edit",
    arguments: {
      name: "Paint",
      update: [{ id: box.id, backgroundColor: "#ffc9c9", text: "Renamed" }],
    },
  });
  const [painted] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Paint" },
  }));
  assert.equal(painted.text, "Renamed");
});

test("edit deletes an element and its label", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Doomed", nodes: ["A", "B"] } });
  const scene = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Doomed" },
  }));
  const target = scene.find((e) => e.text === "A");
  await client.callTool({
    name: "edit", arguments: { name: "Doomed", remove: [target.id] },
  });
  const after = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Doomed" },
  }));
  assert.ok(!after.some((e) => e.text === "A"));
  assert.ok(after.some((e) => e.text === "B"));
});

test("edit on an unknown id reports it instead of failing silently", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Ghosts", nodes: ["A"] } });
  const out = json(await client.callTool({
    name: "edit", arguments: { name: "Ghosts", move: [{ id: "nope", x: 1, y: 1 }] },
  }));
  assert.deepEqual(out.unknownIds, ["nope"]);
});

test("rename and delete work end to end", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Old", nodes: ["A"] } });
  const renamed = json(await client.callTool({
    name: "rename_drawing", arguments: { name: "Old", newName: "New" },
  }));
  assert.equal(renamed.name, "New");
  await client.callTool({ name: "delete_drawing", arguments: { name: "New" } });
  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.ok(!list.some((d) => d.name === "New"));
});

test("reading a drawing that does not exist is an error, not a crash", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "describe_scene", arguments: { name: "Never Existed" },
  });
  assert.equal(result.isError, true);
});

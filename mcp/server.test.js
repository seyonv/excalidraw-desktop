import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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

/** Reads a drawing straight off disk — bypasses describe_scene's summarising,
 * which deliberately hides bound labels and binding internals. */
function readRaw(name) {
  return JSON.parse(readFileSync(join(dir, `${name}.excalidraw`), "utf8"));
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

test("deleting a drawing that does not exist succeeds (idempotent, like the Rust command)", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "delete_drawing", arguments: { name: "Never Existed Either" },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(json(result), { deleted: "Never Existed Either" });
});

test("removing a shape nulls the arrow's binding to it without disturbing the surviving shape", async () => {
  const client = await connect();
  await client.callTool({
    name: "draw",
    arguments: { name: "Bound", nodes: ["A", "B"], edges: [["A", "B"]] },
  });
  const before = readRaw("Bound");
  const labelText = (shapeId) =>
    before.elements.find((el) => el.type === "text" && el.containerId === shapeId)?.text;
  const shapeA = before.elements.find((el) => el.type === "rectangle" && labelText(el.id) === "A");
  const shapeB = before.elements.find((el) => el.type === "rectangle" && labelText(el.id) === "B");
  const arrow = before.elements.find((el) => el.type === "arrow");
  assert.equal(arrow.startBinding.elementId, shapeA.id);
  assert.equal(arrow.endBinding.elementId, shapeB.id);

  await client.callTool({ name: "edit", arguments: { name: "Bound", remove: [shapeA.id] } });

  const after = readRaw("Bound");
  assert.ok(!after.elements.some((el) => el.id === shapeA.id), "shape A is gone");
  assert.ok(!after.elements.some((el) => el.containerId === shapeA.id), "shape A's label is gone");

  const afterArrow = after.elements.find((el) => el.id === arrow.id);
  assert.ok(afterArrow, "arrow itself survives — only shape A was removed");
  assert.equal(afterArrow.startBinding, null, "the dangling end is nulled, not left pointing at nothing");
  assert.equal(afterArrow.endBinding.elementId, shapeB.id, "the surviving end is untouched");

  const afterB = after.elements.find((el) => el.id === shapeB.id);
  assert.ok(
    afterB.boundElements.some((b) => b.id === arrow.id),
    "the surviving shape still knows about the arrow, since the arrow itself is still valid",
  );
});

test("removing an arrow strips its id from both connected shapes' boundElements", async () => {
  const client = await connect();
  await client.callTool({
    name: "draw",
    arguments: { name: "Wired", nodes: ["A", "B"], edges: [["A", "B"]] },
  });
  const before = readRaw("Wired");
  const arrow = before.elements.find((el) => el.type === "arrow");
  const shapes = before.elements.filter((el) => el.type === "rectangle");
  assert.ok(shapes.every((s) => s.boundElements.some((b) => b.id === arrow.id)));

  await client.callTool({ name: "edit", arguments: { name: "Wired", remove: [arrow.id] } });

  const after = readRaw("Wired");
  assert.ok(!after.elements.some((el) => el.id === arrow.id), "arrow is gone");
  for (const shape of after.elements.filter((el) => el.type === "rectangle")) {
    assert.ok(
      !shape.boundElements.some((b) => b.id === arrow.id),
      `${shape.id} no longer references the deleted arrow`,
    );
  }
});

test("append onto negative coordinates lands below and stays finite", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Underground", nodes: ["A"] } });
  const [box] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Underground" },
  }));
  await client.callTool({
    name: "edit",
    arguments: { name: "Underground", move: [{ id: box.id, x: -500, y: -800 }] },
  });
  const before = readRaw("Underground");
  const bottom = Math.max(
    ...before.elements.filter((el) => !el.isDeleted).map((el) => el.y + el.height),
  );

  await client.callTool({
    name: "draw", arguments: { name: "Underground", nodes: ["B"], mode: "append" },
  });

  const after = readRaw("Underground");
  for (const el of after.elements) {
    assert.ok(Number.isFinite(el.x), `${el.id}.x is finite`);
    assert.ok(Number.isFinite(el.y), `${el.id}.y is finite`);
  }
  const added = after.elements.find((el) => el.text === "B");
  assert.ok(added.y >= bottom, "appended content sits below the existing (negative) content");
});

test("draw rejects a malformed argument instead of throwing", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "draw", arguments: { name: 123, nodes: "not-an-array" },
  });
  assert.equal(result.isError, true);
});

test("edit against a drawing that does not exist is an error", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "edit", arguments: { name: "Never Existed", move: [{ id: "x", x: 1, y: 1 }] },
  });
  assert.equal(result.isError, true);
});

test("edit rejects a malformed argument instead of throwing", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Editable", nodes: ["A"] } });
  const result = await client.callTool({
    name: "edit", arguments: { name: "Editable", move: [{ id: "x", x: "bad", y: 1 }] },
  });
  assert.equal(result.isError, true);
});

test("rename_drawing against a drawing that does not exist is an error", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "rename_drawing", arguments: { name: "Never Existed", newName: "Whatever" },
  });
  assert.equal(result.isError, true);
});

test("rename_drawing rejects a malformed argument instead of throwing", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "rename_drawing", arguments: { name: "Whatever", newName: 42 },
  });
  assert.equal(result.isError, true);
});

test("open_drawing against a drawing that does not exist is an error", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "open_drawing", arguments: { name: "Never Existed" },
  });
  assert.equal(result.isError, true);
});

test("open_drawing rejects a malformed argument instead of throwing", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "open_drawing", arguments: { name: 42 },
  });
  assert.equal(result.isError, true);
});

test("delete_drawing rejects a malformed argument instead of throwing", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "delete_drawing", arguments: { name: 42 },
  });
  assert.equal(result.isError, true);
});

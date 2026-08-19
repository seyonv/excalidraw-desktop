#!/usr/bin/env node
// Wiring only. Every behaviour lives in mcp/lib/*.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as library from "./lib/library.js";
import { requestOpen } from "./lib/control.js";
import { buildScene, describe, parseScene, serializeScene } from "./lib/scene.js";

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

const nodeSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    text: z.string(),
    shape: z.enum(["rect", "ellipse", "diamond", "cylinder", "text"]).optional(),
  }),
]);

const edgeSchema = z.union([
  z.tuple([z.string(), z.string()]),
  z.tuple([z.string(), z.string(), z.string()]),
  z.object({ from: z.string(), to: z.string(), label: z.string().optional() }),
]);

/** Shifts a scene's elements down so appended content clears what is there. */
function offsetBelow(existing, scene) {
  const bottom = existing.reduce(
    (max, el) => (el.isDeleted ? max : Math.max(max, el.y + el.height)),
    -Infinity,
  );
  if (!Number.isFinite(bottom)) return scene;
  const top = scene.elements.reduce((min, el) => Math.min(min, el.y), Infinity);
  if (!Number.isFinite(top)) return scene;
  const shift = bottom + 120 - top;
  for (const el of scene.elements) el.y += shift;
  return scene;
}

export function createServer() {
  const server = new McpServer({ name: "excalidraw", version: "0.1.0" });

  server.registerTool(
    "draw",
    {
      title: "Draw a diagram",
      description:
        "Create or replace a drawing in the Excalidraw desktop library and open it. " +
        "Nodes are laid out automatically; a bare string is shorthand for a labelled box. " +
        "Use this for whole diagrams; use `edit` to adjust one that already exists.",
      inputSchema: {
        name: z.string().describe("Drawing name, e.g. 'Auth flow'"),
        nodes: z.array(nodeSchema).optional(),
        edges: z.array(edgeSchema).optional(),
        direction: z.enum(["down", "right"]).optional(),
        mode: z.enum(["replace", "append"]).optional(),
        open: z.boolean().optional(),
      },
    },
    async ({ name, nodes = [], edges = [], direction = "down", mode = "replace", open = true }) => {
      try {
        let scene = buildScene({ nodes, edges, direction });
        if (mode === "append" && (await library.exists(name))) {
          const existing = parseScene(await library.readDrawing(name));
          scene = offsetBelow(existing.elements, scene);
          scene.elements = [...existing.elements, ...scene.elements];
          scene.appState = existing.appState;
          scene.files = existing.files;
        }
        await library.writeDrawing(name, serializeScene(scene));
        if (open) await requestOpen(name);
        return ok({ name, elements: scene.elements.length });
      } catch (e) {
        return fail(`could not draw ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "edit",
    {
      title: "Edit elements in a drawing",
      description:
        "Adjust elements in an existing drawing by id. Get ids from describe_scene. " +
        "Use this for 'move that box left' or 'make the DB node red' — it preserves " +
        "everything else on the canvas, including changes made by hand.",
      inputSchema: {
        name: z.string(),
        move: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })).optional(),
        update: z
          .array(
            z.object({
              id: z.string(),
              text: z.string().optional(),
              strokeColor: z.string().optional(),
              backgroundColor: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
            }),
          )
          .optional(),
        remove: z.array(z.string()).optional(),
        open: z.boolean().optional(),
      },
    },
    async ({ name, move = [], update = [], remove = [], open = true }) => {
      try {
        const scene = parseScene(await library.readDrawing(name));
        const byId = new Map(scene.elements.map((el) => [el.id, el]));
        const labelOf = new Map();
        for (const el of scene.elements) {
          if (el.type === "text" && el.containerId) labelOf.set(el.containerId, el);
        }
        const unknownIds = [];
        const touch = (el) => {
          el.version += 1;
          el.versionNonce = Math.floor(Math.random() * 2 ** 31);
          el.updated = Date.now();
        };

        for (const m of move) {
          const el = byId.get(m.id);
          if (!el) { unknownIds.push(m.id); continue; }
          const dx = m.x - el.x;
          const dy = m.y - el.y;
          el.x = m.x;
          el.y = m.y;
          touch(el);
          const label = labelOf.get(el.id);
          if (label) { label.x += dx; label.y += dy; touch(label); }
        }

        for (const u of update) {
          const el = byId.get(u.id);
          if (!el) { unknownIds.push(u.id); continue; }
          for (const key of ["strokeColor", "backgroundColor", "width", "height"]) {
            if (u[key] !== undefined) el[key] = u[key];
          }
          if (u.text !== undefined) {
            const target = labelOf.get(el.id) ?? (el.type === "text" ? el : null);
            if (target) {
              target.text = u.text;
              target.originalText = u.text;
              touch(target);
            }
          }
          touch(el);
        }

        if (remove.length) {
          const doomed = new Set(remove);
          for (const id of remove) {
            if (!byId.has(id)) { unknownIds.push(id); continue; }
            const label = labelOf.get(id);
            if (label) doomed.add(label.id);
          }
          scene.elements = scene.elements.filter((el) => !doomed.has(el.id));
          // Drop bindings that now point at nothing.
          for (const el of scene.elements) {
            if (Array.isArray(el.boundElements)) {
              el.boundElements = el.boundElements.filter((b) => !doomed.has(b.id));
            }
            if (el.startBinding && doomed.has(el.startBinding.elementId)) el.startBinding = null;
            if (el.endBinding && doomed.has(el.endBinding.elementId)) el.endBinding = null;
          }
        }

        await library.writeDrawing(name, serializeScene(scene));
        if (open) await requestOpen(name);
        return ok({ name, unknownIds });
      } catch (e) {
        return fail(`could not edit ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "list_drawings",
    { title: "List drawings", description: "Every drawing in the library, newest first.", inputSchema: {} },
    async () => ok(await library.listDrawings()),
  );

  server.registerTool(
    "describe_scene",
    {
      title: "Describe a drawing",
      description:
        "A compact summary of what is on a drawing's canvas — element ids, text, " +
        "positions, sizes, and arrow connections. Read this before editing.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return ok(describe(await library.readDrawing(name)));
      } catch (e) {
        return fail(`could not read ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "rename_drawing",
    { title: "Rename a drawing", inputSchema: { name: z.string(), newName: z.string() } },
    async ({ name, newName }) => {
      try {
        return ok({ name: await library.renameDrawing(name, newName) });
      } catch (e) {
        return fail(`could not rename ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "delete_drawing",
    { title: "Delete a drawing", inputSchema: { name: z.string() } },
    async ({ name }) => {
      try {
        await library.deleteDrawing(name);
        return ok({ deleted: name });
      } catch (e) {
        return fail(`could not delete ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "open_drawing",
    {
      title: "Open a drawing in the app",
      description: "Bring the Excalidraw desktop app forward on this drawing.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      if (!(await library.exists(name))) return fail(`${name} does not exist`);
      await requestOpen(name);
      return ok({ opened: name });
    },
  );

  return server;
}

// Self-start on stdio when run directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

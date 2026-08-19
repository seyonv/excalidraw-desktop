import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { sanitize } from "./sanitize.js";

const EXT = "excalidraw";

/** `~/Documents/Excalidraw`, or wherever EXCALIDRAW_LIBRARY_DIR points. */
export function libraryDir() {
  return process.env.EXCALIDRAW_LIBRARY_DIR || join(homedir(), "Documents", "Excalidraw");
}

/** Resolves a name to a path guaranteed to sit directly inside the library. */
export function pathFor(name) {
  const dir = libraryDir();
  const path = join(dir, `${sanitize(name)}.${EXT}`);
  if (dirname(path) !== dir) throw new Error("invalid drawing name");
  return path;
}

async function ensureDir() {
  await fs.mkdir(libraryDir(), { recursive: true });
}

export async function exists(name) {
  try {
    await fs.stat(pathFor(name));
    return true;
  } catch {
    return false;
  }
}

export async function listDrawings() {
  await ensureDir();
  const entries = await fs.readdir(libraryDir());
  const drawings = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !entry.endsWith(`.${EXT}`)) continue;
    const name = entry.slice(0, -(EXT.length + 1));
    const stat = await fs.stat(join(libraryDir(), entry));
    drawings.push({ name, modified: Math.floor(stat.mtimeMs / 1000) });
  }
  drawings.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  return drawings;
}

export async function readDrawing(name) {
  return fs.readFile(pathFor(name), "utf8");
}

export async function writeDrawing(name, contents) {
  await ensureDir();
  await fs.writeFile(pathFor(name), contents, "utf8");
}

/** Appends " 2", " 3", ... until the name is free. */
export async function uniqueName(base) {
  const clean = sanitize(base);
  let candidate = clean;
  let n = 1;
  while (await exists(candidate)) {
    n += 1;
    candidate = `${clean} ${n}`;
  }
  return candidate;
}

/** Returns the name actually used, which may differ if newName collided. */
export async function renameDrawing(oldName, newName) {
  const from = pathFor(oldName);
  if (!(await exists(oldName))) throw new Error(`${oldName} no longer exists`);
  if (pathFor(newName) === from) return sanitize(newName);
  const used = await uniqueName(newName);
  await fs.rename(from, pathFor(used));
  return used;
}

export async function deleteDrawing(name) {
  await fs.rm(pathFor(name), { force: true });
}

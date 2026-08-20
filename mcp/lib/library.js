import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, extname, basename, resolve } from "node:path";
import { sanitize } from "./sanitize.js";

const EXT = "excalidraw";

/** `~/Documents/Excalidraw`, or wherever EXCALIDRAW_LIBRARY_DIR points. */
export function libraryDir() {
  return process.env.EXCALIDRAW_LIBRARY_DIR || join(homedir(), "Documents", "Excalidraw");
}

/** Resolves a name to a path guaranteed to sit directly inside the library.
 * `resolve()` canonicalises the directory (drops a trailing slash, etc.) so
 * the dirname comparison below can't fail on a merely-differently-formatted
 * but equal path — e.g. EXCALIDRAW_LIBRARY_DIR=/tmp/lib/ must not throw. */
export function pathFor(name) {
  const dir = resolve(libraryDir());
  const path = join(dir, `${sanitize(name)}.${EXT}`);
  if (dirname(path) !== dir) throw new Error("invalid drawing name");
  return path;
}

/** The sanitised name a drawing name resolves to on disk. This is the only
 * name the server should ever return to a caller, write into the control
 * file, or hand to another module — see resolveName(). */
export function resolveName(name) {
  return sanitize(name);
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
    if (extname(entry) !== `.${EXT}`) continue;
    const name = basename(entry, `.${EXT}`);
    const stat = await fs.stat(join(libraryDir(), entry));
    drawings.push({ name, modified: Math.floor(stat.mtimeMs / 1000) });
  }
  drawings.sort((a, b) => b.modified - a.modified || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return drawings;
}

export async function readDrawing(name) {
  return fs.readFile(pathFor(name), "utf8");
}

export async function writeDrawing(name, contents) {
  await ensureDir();
  await fs.writeFile(pathFor(name), contents, "utf8");
}

/** Appends " 2", " 3", ... until the name is free. `skip` is an optional path
 * allowed to collide (used by rename, so renaming to the same name is a no-op). */
export async function uniqueName(base, skip) {
  const clean = sanitize(base);
  let candidate = clean;
  let n = 1;
  while (true) {
    const path = pathFor(candidate);
    const exists = await fs.stat(path).then(() => true).catch(() => false);
    if (!exists || path === skip) {
      return candidate;
    }
    n += 1;
    candidate = `${clean} ${n}`;
  }
}

/** Returns the name actually used, which may differ if newName collided. */
export async function renameDrawing(oldName, newName) {
  const from = pathFor(oldName);
  if (!(await exists(oldName))) throw new Error(`${oldName} no longer exists`);
  const resolved = await uniqueName(newName, from);
  const to = pathFor(resolved);
  if (from !== to) {
    await fs.rename(from, to);
  }
  return resolved;
}

export async function deleteDrawing(name) {
  await fs.rm(pathFor(name), { force: true });
}

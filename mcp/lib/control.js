// The app-facing control channel. A dot-prefixed file in the library dir that
// the Tauri watcher picks up — no port, no IPC, and it works whether the app
// is already running or is about to start.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { libraryDir } from "./library.js";

export const OPEN_REQUEST_FILE = ".open-request";

const focusMode = () => process.env.EXCALIDRAW_MCP_FOCUS || "focus";

/** Default targets the existing launcher applet, which handles launch-or-focus. */
function launcher() {
  const custom = process.env.EXCALIDRAW_APP;
  if (custom) return [custom, []];
  return ["open", ["-a", "Excalidraw Dev"]];
}

export async function requestOpen(name) {
  const mode = focusMode();
  if (mode === "off") return;

  await fs.mkdir(libraryDir(), { recursive: true });
  await fs.writeFile(
    join(libraryDir(), OPEN_REQUEST_FILE),
    JSON.stringify({ name, at: Date.now() }),
    "utf8",
  );
  if (mode !== "focus") return;

  // Fire and forget. The app not being installed is not a tool failure —
  // the file is written either way and the sidebar picks it up later.
  await new Promise((resolve) => {
    try {
      const [cmd, args] = launcher();
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve());
      child.on("spawn", () => {
        child.unref();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

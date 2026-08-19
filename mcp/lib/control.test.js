import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-ctl-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;
// Never launch a real app from the test suite.
process.env.EXCALIDRAW_APP = "true";

const { requestOpen, OPEN_REQUEST_FILE, launcher } = await import("./control.js");
const { listDrawings } = await import("./library.js");
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

// === Coverage tests to verify actual launch behaviour ===

test("focus mode DOES launch: marker file exists after requestOpen", async () => {
  rmSync(requestPath, { force: true });
  const markerDir = mkdtempSync(join(tmpdir(), "excalidraw-launch-"));
  const markerPath = join(markerDir, "launched");

  // Create a tiny script that touches a marker file
  const launcherScript = join(markerDir, "fake-app.sh");
  writeFileSync(launcherScript, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf8");
  chmodSync(launcherScript, 0o755);

  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  process.env.EXCALIDRAW_APP = launcherScript;

  await requestOpen("Test draw");

  // Poll for marker with bounded wait (2s in 50ms steps) since spawn is detached
  let found = false;
  for (let i = 0; i < 40; i++) {
    if (existsSync(markerPath)) {
      found = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  assert.ok(found, "launcher was called and marker file created");
  process.env.EXCALIDRAW_APP = "true";
  rmSync(markerDir, { recursive: true, force: true });
});

test("switch mode does NOT launch: marker absent but file written", async () => {
  rmSync(requestPath, { force: true });
  const markerDir = mkdtempSync(join(tmpdir(), "excalidraw-launch-"));
  const markerPath = join(markerDir, "launched");

  const launcherScript = join(markerDir, "fake-app.sh");
  writeFileSync(launcherScript, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf8");
  chmodSync(launcherScript, 0o755);

  process.env.EXCALIDRAW_MCP_FOCUS = "switch";
  process.env.EXCALIDRAW_APP = launcherScript;

  await requestOpen("Test draw");

  // Short wait to confirm marker is NOT created
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(existsSync(markerPath), false, "launcher was not called");
  assert.ok(existsSync(requestPath), "but request file was written");

  process.env.EXCALIDRAW_APP = "true";
  rmSync(markerDir, { recursive: true, force: true });
});

test("off mode: neither marker nor file", async () => {
  rmSync(requestPath, { force: true });
  const markerDir = mkdtempSync(join(tmpdir(), "excalidraw-launch-"));
  const markerPath = join(markerDir, "launched");

  const launcherScript = join(markerDir, "fake-app.sh");
  writeFileSync(launcherScript, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf8");
  chmodSync(launcherScript, 0o755);

  process.env.EXCALIDRAW_MCP_FOCUS = "off";
  process.env.EXCALIDRAW_APP = launcherScript;

  await requestOpen("Test draw");

  assert.equal(existsSync(markerPath), false, "launcher not called");
  assert.equal(existsSync(requestPath), false, "request file not written");

  process.env.EXCALIDRAW_APP = "true";
  rmSync(markerDir, { recursive: true, force: true });
});

test("unset EXCALIDRAW_MCP_FOCUS behaves as focus (writes and launches)", async () => {
  rmSync(requestPath, { force: true });
  const markerDir = mkdtempSync(join(tmpdir(), "excalidraw-launch-"));
  const markerPath = join(markerDir, "launched");

  const launcherScript = join(markerDir, "fake-app.sh");
  writeFileSync(launcherScript, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf8");
  chmodSync(launcherScript, 0o755);

  delete process.env.EXCALIDRAW_MCP_FOCUS;
  process.env.EXCALIDRAW_APP = launcherScript;

  await requestOpen("Test draw");

  // Poll for marker
  let found = false;
  for (let i = 0; i < 40; i++) {
    if (existsSync(markerPath)) {
      found = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  assert.ok(found, "launcher was called (default focus mode)");
  assert.ok(existsSync(requestPath), "request file was written");

  process.env.EXCALIDRAW_APP = "true";
  rmSync(markerDir, { recursive: true, force: true });
});

test("garbage EXCALIDRAW_MCP_FOCUS value like 'banana' writes but does NOT launch", async () => {
  rmSync(requestPath, { force: true });
  const markerDir = mkdtempSync(join(tmpdir(), "excalidraw-launch-"));
  const markerPath = join(markerDir, "launched");

  const launcherScript = join(markerDir, "fake-app.sh");
  writeFileSync(launcherScript, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf8");
  chmodSync(launcherScript, 0o755);

  process.env.EXCALIDRAW_MCP_FOCUS = "banana";
  process.env.EXCALIDRAW_APP = launcherScript;

  await requestOpen("Test draw");

  // Short wait to confirm marker is NOT created
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(existsSync(markerPath), false, "launcher not called (safe default: only 'focus' launches)");
  assert.ok(existsSync(requestPath), "but request file was written");

  process.env.EXCALIDRAW_APP = "true";
  rmSync(markerDir, { recursive: true, force: true });
});

test("launcher() returns default when EXCALIDRAW_APP is unset", () => {
  delete process.env.EXCALIDRAW_APP;
  const [cmd, args] = launcher();
  assert.deepEqual([cmd, args], ["open", ["-a", "Excalidraw Dev"]]);
  process.env.EXCALIDRAW_APP = "true";
});

test("launcher() returns default when EXCALIDRAW_APP is empty string (falsy fallback case)", () => {
  process.env.EXCALIDRAW_APP = "";
  const [cmd, args] = launcher();
  assert.deepEqual([cmd, args], ["open", ["-a", "Excalidraw Dev"]], "empty string must fall back to default, not spawn empty command");
  process.env.EXCALIDRAW_APP = "true";
});

test("launcher() returns custom command when EXCALIDRAW_APP is set", () => {
  process.env.EXCALIDRAW_APP = "/bin/true";
  const [cmd, args] = launcher();
  assert.deepEqual([cmd, args], ["/bin/true", []]);
  process.env.EXCALIDRAW_APP = "true";
});

test("JSON payload correctness: special characters round-trip", async () => {
  const testCases = [
    'Test "with" quotes',
    "Test 'with' apostrophes",
    "Test with unicode: café ñ 🎨",
    "Test with\nnewline",
    "  leading and trailing spaces  ",
  ];

  for (const name of testCases) {
    rmSync(requestPath, { force: true });
    process.env.EXCALIDRAW_MCP_FOCUS = "switch";

    await requestOpen(name);

    const parsed = JSON.parse(readFileSync(requestPath, "utf8"));
    assert.equal(parsed.name, name, `name "${name}" round-tripped correctly`);
  }

  process.env.EXCALIDRAW_APP = "true";
});

test("repeated calls OVERWRITE rather than append", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "switch";

  await requestOpen("First");
  await requestOpen("Second");

  const parsed = JSON.parse(readFileSync(requestPath, "utf8"));
  assert.equal(parsed.name, "Second", "only second name is present");

  // Verify file is still valid JSON (not concatenated)
  assert.ok(parsed.at, "timestamp is present in second write");
});

test("cross-module boundary: listDrawings() must not return control file", async () => {
  rmSync(requestPath, { force: true });

  // Create a real .excalidraw file so listDrawings returns something
  const realDrawing = join(dir, "real.excalidraw");
  await fs.writeFile(realDrawing, JSON.stringify({ type: "excalidraw" }), "utf8");

  // Write a control file
  process.env.EXCALIDRAW_MCP_FOCUS = "switch";
  await requestOpen("Control test");

  const drawings = await listDrawings();
  const names = drawings.map(d => d.name);

  assert.ok(names.includes("real"), "real drawing is listed");
  assert.equal(names.includes("open-request"), false, "control file is NOT listed (checked by .excalidraw extension, not dot-prefix)");
});

test("requestOpen never rejects: nonexistent command", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  process.env.EXCALIDRAW_APP = "/nonexistent/path/to/command";

  // Wrap in timeout to fail loudly if it hangs
  const promise = Promise.race([
    requestOpen("Test"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("requestOpen timed out")), 5000)
    ),
  ]);

  await promise; // Must not throw or reject
  process.env.EXCALIDRAW_APP = "true";
});

test("requestOpen never rejects: non-executable file", async () => {
  rmSync(requestPath, { force: true });
  const tempDir = mkdtempSync(join(tmpdir(), "excalidraw-noexec-"));
  const notExecutable = join(tempDir, "not-executable");
  writeFileSync(notExecutable, "#!/bin/bash\necho test\n", "utf8");
  chmodSync(notExecutable, 0o644); // Not executable

  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  process.env.EXCALIDRAW_APP = notExecutable;

  const promise = Promise.race([
    requestOpen("Test"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("requestOpen timed out")), 5000)
    ),
  ]);

  await promise; // Must not throw or reject
  process.env.EXCALIDRAW_APP = "true";
  rmSync(tempDir, { recursive: true, force: true });
});

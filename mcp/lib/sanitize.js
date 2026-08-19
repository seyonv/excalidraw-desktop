// Mirrors sanitize() in src-tauri/src/lib.rs. That function is the security
// boundary; this copy exists so the server can predict a filename without
// asking the app. mcp/fixtures/sanitize-cases.json pins the two together —
// if you change one, the other's test fails.

const ILLEGAL = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\0"]);

const isControl = (ch) => {
  const code = ch.codePointAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

export function sanitize(name) {
  const cleaned = [...String(name ?? "")]
    .map((ch) => (ILLEGAL.has(ch) || isControl(ch) ? "-" : ch))
    .join("");
  const trimmed = cleaned.trim().replace(/^\.+|\.+$/g, "").trim();
  if (trimmed === "") return "Untitled";
  return [...trimmed].slice(0, 120).join("");
}

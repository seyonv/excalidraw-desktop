#!/usr/bin/env node
// A minimal App Store Connect API client, for the release steps fastlane does
// not cover.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… node scripts/asc.mjs GET  /v1/apps
//   ASC_KEY_ID=… ASC_ISSUER_ID=… node scripts/asc.mjs POST /v1/bundleIds '<json body>'
//
// The private key is read from ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8,
// where xcrun altool also looks for it.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuer } = process.env;
if (!keyId || !issuer) {
  console.error("set ASC_KEY_ID and ASC_ISSUER_ID");
  process.exit(2);
}
const [method = "GET", path, body] = process.argv.slice(2);
if (!path) {
  console.error("usage: asc.mjs <METHOD> <path> [json body]");
  process.exit(2);
}

const b64url = (data) => Buffer.from(data).toString("base64url");

function token() {
  const key = createPrivateKey(
    readFileSync(join(homedir(), ".appstoreconnect/private_keys", `AuthKey_${keyId}.p8`)),
  );
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${claims}.${b64url(signature)}`;
}

const url = path.startsWith("http") ? path : `https://api.appstoreconnect.apple.com${path}`;
const res = await fetch(url, {
  method,
  headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
  body,
});
const text = await res.text();
process.stdout.write(text ? JSON.stringify(JSON.parse(text), null, 2) + "\n" : "");
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}

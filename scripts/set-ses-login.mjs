#!/usr/bin/env node
// Turns an AWS access key into an Amazon SES SMTP login and saves it straight into the
// gtm-flow Vercel project (SES_SMTP_USER / SES_SMTP_PASS, Production). Nothing is printed
// and nothing is written to disk — the secret goes from your keyboard to Vercel.
//
//   node scripts/set-ses-login.mjs
//
// The SMTP password is derived from the secret access key with AWS's documented
// algorithm (HMAC-SHA256 chain, version byte 0x04, base64) for the Sydney region.

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import readline from "node:readline";

const REGION = process.env.SES_REGION || "ap-southeast-2";

function smtpPassword(secretKey, region) {
  const sign = (key, msg) => createHmac("sha256", key).update(msg, "utf8").digest();
  let sig = sign(Buffer.from(`AWS4${secretKey}`, "utf8"), "11111111");
  for (const part of [region, "ses", "aws4_request", "SendRawEmail"]) sig = sign(sig, part);
  return Buffer.concat([Buffer.from([0x04]), sig]).toString("base64");
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Read a line with NOTHING echoed: raw mode, keystrokes and pastes are never written back. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("  [received, hidden]\n");
          // Terminals wrap a paste in bracketed-paste markers (ESC[200~ … ESC[201~); the ESC is
          // already dropped above, so strip what is left of them.
          return resolve(value.replace(/\[20[01]~/g, "").trim());
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(1); } // Ctrl-C
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function setEnv(name, value) {
  for (const env of ["production"]) {
    try { execFileSync("vercel", ["env", "rm", name, env, "--yes"], { stdio: "ignore" }); } catch { /* not set yet */ }
    execFileSync("vercel", ["env", "add", name, env], { input: value, stdio: ["pipe", "ignore", "inherit"] });
  }
}

const keyId = await ask("Access key ID (starts with AKIA): ");
if (!/^AKIA[A-Z0-9]{16}$/.test(keyId)) { console.error("That doesn't look like an access key ID (AKIA + 16 letters/digits). Nothing saved."); process.exit(1); }
const secret = await askHidden("Secret access key (nothing will show as you paste — press Enter): ");
if (secret.length < 30) { console.error("That secret looks too short. Nothing saved."); process.exit(1); }

setEnv("SES_SMTP_USER", keyId);
setEnv("SES_SMTP_PASS", smtpPassword(secret, REGION));
console.log("Saved SES_SMTP_USER and SES_SMTP_PASS to gtm-flow (Production). Tell Claude \"done\" to redeploy and test.");

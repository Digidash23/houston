// Usage: node scripts/ci/verify-updater-signature.mjs <file> <file.sig> <tauri.conf.json>
// Exits non-zero unless <file.sig> is a valid updater signature of <file> from
// the pubkey the shipped app trusts (plugins.updater.pubkey).
import { readFile } from "node:fs/promises";
import { verifyUpdaterSignature } from "./updater-signature.mjs";

const [file, sigFile, configFile] = process.argv.slice(2);
if (!file || !sigFile || !configFile) {
  throw new Error(
    "usage: verify-updater-signature.mjs <file> <file.sig> <tauri.conf.json>",
  );
}
const config = JSON.parse(await readFile(configFile, "utf8"));
const pubkey = config.plugins?.updater?.pubkey;
if (typeof pubkey !== "string" || pubkey === "") {
  throw new Error(`${configFile} has no plugins.updater.pubkey`);
}
const { keyId, trustedComment } = verifyUpdaterSignature({
  pubkey,
  signature: await readFile(sigFile, "utf8"),
  data: await readFile(file),
});
console.log(
  `Updater signature OK: ${file} signed by key ${keyId} (${trustedComment})`,
);

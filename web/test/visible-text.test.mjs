// Regression test: the old "Angry Birds" name must not appear in anything the player can see
// (page title, install manifest, or the strings and comments in the app source).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD_NAME = /angry\s*birds/i;

function listSources(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listSources(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const visibleFiles = [
  join(webRoot, "index.html"),
  join(webRoot, "vite.config.ts"),
  ...listSources(join(webRoot, "src")),
];

test("no visible file mentions the old 'Angry Birds' name", () => {
  const offenders = visibleFiles.filter((file) => OLD_NAME.test(readFileSync(file, "utf8")));
  assert.deepEqual(
    offenders.map((file) => relative(webRoot, file)),
    [],
    "Found 'Angry Birds' in visible text",
  );
});

test("page title and manifest use the new name", () => {
  const html = readFileSync(join(webRoot, "index.html"), "utf8");
  assert.match(html, /<title>Bird Launcher — FreeGameStore<\/title>/);

  // The install manifest is declared in vite.config.ts (VitePWA).
  const config = readFileSync(join(webRoot, "vite.config.ts"), "utf8");
  assert.match(config, /name: "Bird Launcher"/);
  assert.match(config, /short_name: "Bird Launcher"/);
});

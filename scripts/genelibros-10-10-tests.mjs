import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync("App.tsx", "utf8");
const dash = fs.readFileSync("components/GenerationDashboard.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.match(app, /GENELIBROS_10_10_SINGLE_ORCHESTRATOR/);
assert.match(app, /runWithRetry/);
assert.match(app, /\[GENELIBROS 10\/10\] LIBRO TERMINADO/);
assert.match(app, /fullBookAutostartRef/);

assert.doesNotMatch(dash, /handleAutogenerateAll/);
assert.doesNotMatch(dash, /autoQueueRef/);
assert.match(dash, /onClick=\{\(\) => onGenerateRemaining\(\)\}/);
assert.match(dash, /GENELIBROS_10_10_DERIVED_COMPLETION/);
assert.match(dash, /✅ LIBRO TERMINADO/);
assert.match(dash, /ch\?\.chapter_title \|\| ch\?\.title/);

assert.equal(pkg.scripts?.["genelibros:10:test"], "node scripts/genelibros-10-10-tests.mjs");

console.log("GENELIBROS_10_10_TEST_PASS");

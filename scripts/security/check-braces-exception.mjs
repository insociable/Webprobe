#!/usr/bin/env node
// Guard the approved development-only advisory. This does NOT patch braces.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const advisory = "GHSA-vfj7-8cjw-p6xm";
const packageVersion = "3.0.3";
const expectedExpires = "2026-11-14";
const expectedNames = [
  "eslint-config-next",
  "@next/eslint-plugin-next",
  "fast-glob",
  "micromatch",
  "braces",
];
const config = readFileSync("osv-scanner.toml", "utf8");
const ids = [...config.matchAll(/^id\s*=\s*"([^"]+)"/gm)].map(
  (item) => item[1],
);
const expiryMatch = config.match(/^ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2})$/m);
const reasonMatch = config.match(/^reason\s*=\s*"([^"]+)"$/m);
assert.deepEqual(ids, [advisory], "Unexpected additional OSV exceptions");
assert.equal(expiryMatch?.[1], expectedExpires, "Unexpected expiry date");
assert.ok(
  reasonMatch?.[1]?.length > 80,
  "Exception requires a documented rationale",
);

const expiry = Date.parse(expectedExpires + "T23:59:59Z");
const daysRemaining = (expiry - Date.now()) / 86_400_000;
assert.ok(
  daysRemaining >= 0 && daysRemaining <= 32,
  "Exception expired or extended too far",
);

function pnpmList(prod) {
  const args = ["-r", "list", "--json", "--depth", "6"];
  if (prod) args.push("--prod");
  const result = execFileSync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 90_000,
  });
  const workspaces = JSON.parse(result);
  assert.ok(
    Array.isArray(workspaces) && workspaces.length === 6,
    "Unexpected workspace count",
  );
  return workspaces;
}

function findBraces(workspaces) {
  const hits = [];
  function visit(node, names, edgeKinds, depth) {
    assert.ok(depth <= 40, "Dependency traversal depth exceeded");
    for (const kind of [
      "dependencies",
      "optionalDependencies",
      "devDependencies",
    ]) {
      for (const [name, pkg] of Object.entries(node[kind] ?? {})) {
        const namesNext = [...names, name];
        const edgesNext = [...edgeKinds, kind];
        if (name === "braces") {
          hits.push({
            workspace: names[0],
            names: namesNext.slice(1),
            edges: edgesNext,
            version: pkg.version,
          });
        }
        if (pkg && typeof pkg === "object" && depth < 40) {
          visit(pkg, namesNext, edgesNext, depth + 1);
        }
      }
    }
  }
  for (const root of workspaces) visit(root, [root.name], [], 0);
  return hits;
}

const productionHits = findBraces(pnpmList(true));
assert.equal(
  productionHits.length,
  0,
  "braces unexpectedly present in production dependency graph",
);
const allHits = findBraces(pnpmList(false));
assert.equal(
  allHits.length,
  1,
  "Unexpected new or missing braces dependency path",
);
const [hit] = allHits;
assert.equal(hit.workspace, "web", "braces moved to an unexpected workspace");
assert.equal(
  hit.version,
  packageVersion,
  "braces version changed; reassess exception",
);
assert.deepEqual(
  hit.names,
  expectedNames,
  "New braces import path; reassess exception",
);
assert.deepEqual(
  hit.edges,
  [
    "devDependencies",
    "dependencies",
    "dependencies",
    "dependencies",
    "dependencies",
  ],
  "braces must remain a transitive dependency of development-only tooling",
);

const message =
  advisory +
  " remains accepted temporarily for braces@" +
  packageVersion +
  " in dev-only Next ESLint tooling; absent from all " +
  "six production dependency graphs. Exception expires " +
  expectedExpires +
  ". No upstream patched version.";
console.log("::warning::" + message);
console.log(
  "PASS: scoped dev-only advisory policy (" +
    daysRemaining.toFixed(1) +
    " days remaining)",
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "### Accepted dependency risk — not fixed\n\n" +
      "**" +
      advisory +
      "**, braces@" +
      packageVersion +
      " (High). NOT present in the production dependency graph; via " +
      "eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch > braces.\n\n" +
      "Temporary, explicitly accepted exception, expires **" +
      expectedExpires +
      "**. " +
      "No published upstream fix. New advisories, paths/versions, or expiry still fail.\n\n",
  );
}

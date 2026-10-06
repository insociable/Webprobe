import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  artifactCleanupTasks,
  scanArtifacts,
  scans,
  sites,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "../src/database.js";
import {
  isValidArtifactStorageKey,
  isValidArtifactTemporaryName,
  scanArtifactStorageRoot,
} from "../src/scan-artifacts.js";

const MIN_AGE_MS = 24 * 60 * 60_000;
type Candidate = {
  key: string;
  observedName: string;
  size: number;
  mtimeMs: number;
};
type Manifest = {
  version: 1;
  root: string;
  createdAt: string;
  candidates: Candidate[];
};

function assertSafeDirectory(info: Awaited<ReturnType<typeof lstat>>): void {
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe artifact directory");
}

async function enumerate(root: string): Promise<Candidate[]> {
  const result: Candidate[] = [];
  try {
    assertSafeDirectory(await lstat(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const org of await readdir(root)) {
    if (!uuid.test(org)) continue;
    const orgDir = path.join(root, org);
    assertSafeDirectory(await lstat(orgDir));
    for (const site of await readdir(orgDir)) {
      if (!uuid.test(site)) continue;
      const siteDir = path.join(orgDir, site);
      assertSafeDirectory(await lstat(siteDir));
      for (const scan of await readdir(siteDir)) {
        if (!uuid.test(scan)) continue;
        const scanDir = path.join(siteDir, scan);
        assertSafeDirectory(await lstat(scanDir));
        const key = [org, site, scan, "primary.jpg"].join("/");
        if (!isValidArtifactStorageKey(key)) continue;
        const names = await readdir(scanDir);
        const observed = names.includes("primary.jpg")
          ? ["primary.jpg"]
          : names.filter(isValidArtifactTemporaryName);
        const files: Candidate[] = [];
        for (const observedName of observed) {
          const info = await lstat(path.join(scanDir, observedName));
          if (!info.isFile() || info.isSymbolicLink())
            throw new Error("Unsafe artifact file");
          files.push({
            key,
            observedName,
            size: info.size,
            mtimeMs: info.mtimeMs,
          });
        }
        const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
        if (newest) result.push(newest);
      }
    }
  }
  return result;
}

async function eligible(candidate: Candidate, now: number): Promise<boolean> {
  if (
    !isValidArtifactStorageKey(candidate.key) ||
    candidate.mtimeMs > now - MIN_AGE_MS
  )
    return false;
  const { db } = getDatabase();
  const [orgId, siteId, scanId] = candidate.key.split("/") as [
    string,
    string,
    string,
    string,
  ];
  const [artifact] = await db
    .select({ id: scanArtifacts.id })
    .from(scanArtifacts)
    .where(eq(scanArtifacts.storageKey, candidate.key))
    .limit(1);
  if (artifact) return false;
  const [task] = await db
    .select({ id: artifactCleanupTasks.id })
    .from(artifactCleanupTasks)
    .where(eq(artifactCleanupTasks.storageKey, candidate.key))
    .limit(1);
  if (task) return false;
  const [scan] = await db
    .select({ status: scans.status })
    .from(scans)
    .where(
      and(
        eq(scans.id, scanId),
        eq(scans.siteId, siteId),
        eq(scans.organizationId, orgId),
      ),
    )
    .limit(1);
  return !scan || (scan.status !== "queued" && scan.status !== "running");
}

async function stage(candidate: Candidate, root: string): Promise<boolean> {
  const [orgId, siteId, scanId] = candidate.key.split("/") as [
    string,
    string,
    string,
    string,
  ];
  if (
    !isValidArtifactStorageKey(candidate.key) ||
    (candidate.observedName !== "primary.jpg" &&
      !isValidArtifactTemporaryName(candidate.observedName))
  )
    return false;
  let directory = root;
  assertSafeDirectory(await lstat(directory));
  for (const segment of [orgId, siteId, scanId]) {
    directory = path.join(directory, segment);
    try {
      assertSafeDirectory(await lstat(directory));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path.join(directory, candidate.observedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size !== candidate.size ||
    Math.abs(info.mtimeMs - candidate.mtimeMs) > 1
  )
    return false;
  if (!(await eligible(candidate, Date.now()))) return false;
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.organizationId, orgId)))
      .for("update")
      .limit(1);
    const [scan] = await tx
      .select({ status: scans.status })
      .from(scans)
      .where(
        and(
          eq(scans.id, scanId),
          eq(scans.siteId, siteId),
          eq(scans.organizationId, orgId),
        ),
      )
      .for("update")
      .limit(1);
    if (scan && (scan.status === "queued" || scan.status === "running"))
      return false;
    const [artifact] = await tx
      .select({ id: scanArtifacts.id })
      .from(scanArtifacts)
      .where(eq(scanArtifacts.storageKey, candidate.key))
      .limit(1);
    if (artifact) return false;
    const [task] = await tx
      .select({ id: artifactCleanupTasks.id })
      .from(artifactCleanupTasks)
      .where(eq(artifactCleanupTasks.storageKey, candidate.key))
      .for("update")
      .limit(1);
    if (task) return false;
    await tx.insert(artifactCleanupTasks).values({
      storageKey: candidate.key,
      action: "delete",
      organizationId: site ? orgId : null,
      siteId: site ? siteId : null,
      scanId: scan ? scanId : null,
    });
    return true;
  });
}

const args = process.argv.slice(2);
const mode = args[0];
const manifestPath = args[1];
if (
  !["--inventory", "--stage"].includes(mode ?? "") ||
  !manifestPath ||
  args.length !== 2
) {
  throw new Error(
    "Usage: tsx scripts/artifact-orphan-inventory.ts --inventory|--stage <manifest.json>",
  );
}
const root = scanArtifactStorageRoot();
if (mode === "--inventory") {
  const all = await enumerate(root);
  const candidates: Candidate[] = [];
  for (const item of all)
    if (await eligible(item, Date.now())) candidates.push(item);
  const manifest: Manifest = {
    version: 1,
    root,
    createdAt: new Date().toISOString(),
    candidates,
  };
  const handle = await open(manifestPath!, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(manifest, null, 2) + "\n");
  } finally {
    await handle.close();
  }
  console.log(
    JSON.stringify({
      inspected: all.length,
      orphanCandidates: candidates.length,
      manifestSha256: createHash("sha256")
        .update(JSON.stringify(manifest))
        .digest("hex"),
    }),
  );
} else {
  const manifest = JSON.parse(
    await readFile(manifestPath!, "utf8"),
  ) as Manifest;
  if (
    manifest.version !== 1 ||
    manifest.root !== root ||
    !Array.isArray(manifest.candidates)
  ) {
    throw new Error("Invalid or mismatched inventory manifest");
  }
  let staged = 0,
    skipped = 0;
  for (const item of manifest.candidates) {
    if (await stage(item, root)) staged++;
    else skipped++;
  }
  console.log(JSON.stringify({ staged, skipped }));
}

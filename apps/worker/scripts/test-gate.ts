import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Redis } from "ioredis";
import postgres from "postgres";

type TestMode = "workspace" | "worker";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const workerRoot = resolve(repoRoot, "apps/worker");

config({ path: resolve(repoRoot, ".env") });

const mode = process.argv[2] as TestMode | undefined;
const extraTestArgs = process.argv.slice(3).filter((arg) => arg !== "--");
if (mode !== "workspace" && mode !== "worker") {
  throw new Error("test-gate mode must be 'workspace' or 'worker'");
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} failed (${
            signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`
          })`,
        ),
      );
    });
  });
}

async function runTarget(env: NodeJS.ProcessEnv): Promise<void> {
  if (mode === "workspace") {
    await run(
      "pnpm",
      ["exec", "turbo", "test", "--concurrency=1"],
      repoRoot,
      env,
    );
    return;
  }

  await run(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--passWithNoTests",
      "--no-file-parallelism",
      ...extraTestArgs,
    ],
    workerRoot,
    env,
  );
}

if (process.env.AGENCY_TEST_ISOLATED === "1") {
  await runTarget(process.env);
  process.exit(0);
}

const integrationEnabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_REDIS_INTEGRATION === "1";

if (!integrationEnabled) {
  await runTarget({ ...process.env, AGENCY_TEST_ISOLATED: "1" });
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.REDIS_URL?.trim();
if (!databaseUrl || !redisUrl) {
  throw new Error(
    "DATABASE_URL and REDIS_URL are required for isolated integration tests",
  );
}

const baseDatabaseUrl = new URL(databaseUrl);
const baseName = baseDatabaseUrl.pathname
  .replace(/^\//, "")
  .replace(/[^a-zA-Z0-9_]/g, "_")
  .slice(0, 32);
const suffix = `${process.pid}_${randomUUID().slice(0, 8)}`;
const testDatabaseName = `${baseName || "agency"}_test_${suffix}`.slice(0, 63);

const adminDatabaseUrl = new URL(baseDatabaseUrl);
adminDatabaseUrl.pathname = "/postgres";

const testDatabaseUrl = new URL(baseDatabaseUrl);
testDatabaseUrl.pathname = `/${testDatabaseName}`;

const testRedisUrl = new URL(redisUrl);
testRedisUrl.pathname = "/15";

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  AGENCY_TEST_ISOLATED: "1",
  DATABASE_URL: testDatabaseUrl.toString(),
  REDIS_URL: testRedisUrl.toString(),
};

let createdDatabase = false;
let primaryError: unknown;

try {
  const admin = postgres(adminDatabaseUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    await admin.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    createdDatabase = true;
  } finally {
    await admin.end();
  }

  const redis = new Redis(testRedisUrl.toString(), {
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }

  console.log(`test isolation: PostgreSQL temp DB + Valkey DB 15 (${mode})`);

  await run(
    "pnpm",
    ["--filter", "@agency-saas/db", "db:migrate"],
    repoRoot,
    childEnv,
  );
  await runTarget(childEnv);
} catch (error) {
  primaryError = error;
} finally {
  try {
    const redis = new Redis(testRedisUrl.toString(), {
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.flushdb();
    } finally {
      await redis.quit();
    }
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
  }

  if (createdDatabase) {
    try {
      const admin = postgres(adminDatabaseUrl.toString(), {
        max: 1,
        prepare: false,
        connect_timeout: 10,
      });
      try {
        await admin.unsafe(
          `DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`,
        );
      } finally {
        await admin.end();
      }
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
}

if (primaryError) {
  throw primaryError;
}

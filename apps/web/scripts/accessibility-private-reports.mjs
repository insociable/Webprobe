import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const fixtureDir = process.env.A11Y_FIXTURE_DIR;
const base = new URL(process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3108");
assert.ok(fixtureDir, "A11Y_FIXTURE_DIR is required");
assert.ok(
  base.protocol === "http:" && base.hostname === "127.0.0.1",
  "A local HTTP test server is required",
);
const statePath = path.join(fixtureDir, "browser-state.json");
await stat(statePath);
const sites = (await readFile(path.join(fixtureDir, "siteids.txt"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => line.split("|"));
const deep = sites.find((site) => site[0] === "Site fictif Deep");
const standard = sites.find((site) => site[0] === "Site fictif standard");
const monitoring = (
  await readFile(path.join(fixtureDir, "monitoring-ids.txt"), "utf8")
)
  .trim()
  .split("|");
assert.ok(deep && standard && monitoring.length === 3, "Fixture incomplete");

const scanPath = ([, org, site, scan]) =>
  `/organizations/${org}/sites/${site}/scans/${scan}`;
const routes = [
  ["dashboard", "/dashboard", false],
  ["sites", "/sites", false],
  ["import", `/organizations/${standard[1]}/sites/import`, false],
  ["dns", `/organizations/${standard[1]}/sites/${standard[2]}/verify`, false],
  ["standard", scanPath(standard), true],
  ["deep", scanPath(deep), true],
  [
    "monitoring",
    `/organizations/${monitoring[0]}/sites/${monitoring[1]}/scans/${monitoring[2]}`,
    true,
  ],
];

const browser = await chromium.launch({ headless: true });
let checks = 0;
let currentCheck = "fixture setup";
try {
  const lookup = await browser.newContext({ storageState: statePath });
  await lookup.route("**/*", (route) =>
    new URL(route.request().url()).origin === base.origin
      ? route.continue()
      : route.abort(),
  );
  const lookupPage = await lookup.newPage();
  await lookupPage.goto(new URL(routes.at(-1)[1], base).toString());
  const sharedHref = await lookupPage
    .locator('a[href*="/r/"]')
    .first()
    .getAttribute("href");
  await lookup.close();
  assert.ok(sharedHref, "Shared report fixture missing");
  const sharedPath = new URL(sharedHref, base).pathname;
  assert.ok(/^\/r\/[^/]+$/.test(sharedPath), "Shared report path invalid");

  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({
      storageState: statePath,
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript(
      (value) => localStorage.setItem("agency-monitor-theme", value),
      theme,
    );
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base.origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();

    for (const [name, routePath, isReport] of routes) {
      await page.goto(new URL(routePath, base).toString(), {
        waitUntil: "domcontentloaded",
      });
      if (new URL(page.url()).pathname !== routePath) {
        throw new Error(`${name}: unexpected redirect`);
      }
      await page.locator("h1").first().waitFor();
      for (const width of [320, 375, 640, 768, 1280]) {
        currentCheck = `${name} ${theme} ${width}`;
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => {
          const box = (selector) => {
            const element = document.querySelector(selector);
            if (!element || getComputedStyle(element).display === "none")
              return null;
            const { left, right, top, bottom } =
              element.getBoundingClientRect();
            return { left, right, top, bottom };
          };
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            theme: document.documentElement.dataset.theme,
            brand: box(".am-topbar-brand"),
            actions: box(".am-topbar-actions"),
          };
        });
        assert.equal(layout.theme, theme, `${name} ${width}: theme`);
        assert.ok(
          layout.overflow <= 1,
          `${name} ${theme} ${width}: horizontal overflow ${layout.overflow}`,
        );
        if (width < 1024) {
          assert.ok(
            layout.brand && layout.actions,
            `${name} ${width}: mobile controls hidden`,
          );
          assert.ok(
            layout.brand.left >= 0 && layout.brand.right <= width,
            `${name} ${width}: brand clipped`,
          );
          assert.ok(
            layout.actions.left >= 0 && layout.actions.right <= width,
            `${name} ${width}: actions clipped`,
          );
          const separated =
            layout.brand.bottom <= layout.actions.top ||
            layout.actions.bottom <= layout.brand.top ||
            layout.brand.right <= layout.actions.left ||
            layout.actions.right <= layout.brand.left;
          assert.ok(separated, `${name} ${width}: brand/actions overlap`);
          await page
            .locator(".am-topbar")
            .getByRole("link", { name: /WebProbe/ })
            .waitFor();
          await page
            .locator(".am-topbar")
            .getByRole("button", { name: "Sombre" })
            .waitFor();
          await page
            .locator(".am-topbar")
            .getByRole("button", { name: "Clair" })
            .waitFor();
          await page
            .locator(".am-topbar")
            .getByRole("button", { name: "Quitter" })
            .waitFor();
        }
        if (isReport) {
          const violations = (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          ).violations;
          assert.deepEqual(
            violations.map((violation) => violation.id),
            [],
            `${name} ${theme} ${width}: axe`,
          );
        }
        checks += 1;
      }
      if (isReport) {
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        assert.ok(pdf.length > 10000, `${name}: PDF is empty`);
        await writeFile(
          path.join(fixtureDir, `codex-${name}-${theme}.pdf`),
          pdf,
          {
            mode: 0o600,
          },
        );
      }
      console.log(`PASS ${name} ${theme}: 320/375/640/768/1280 px`);
    }

    currentCheck = `keyboard ${theme}`;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(new URL("/dashboard", base).toString());
    const dark = page
      .locator(".am-topbar")
      .getByRole("button", { name: "Sombre" });
    const light = page
      .locator(".am-topbar")
      .getByRole("button", { name: "Clair" });
    await dark.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
      "Clair",
    );
    assert.ok(
      await page.evaluate(
        () =>
          document.activeElement?.matches(":focus-visible") &&
          parseFloat(getComputedStyle(document.activeElement).outlineWidth) >=
            2,
      ),
      "Theme control must have a visible keyboard focus",
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
      "Sombre",
    );
    await light.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    await page.keyboard.press("Escape");
    await dark.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );

    const publicContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await publicContext.addInitScript(
      (value) => localStorage.setItem("agency-monitor-theme", value),
      theme,
    );
    await publicContext.route("**/*", (route) =>
      new URL(route.request().url()).origin === base.origin
        ? route.continue()
        : route.abort(),
    );
    const shared = await publicContext.newPage();
    await shared.goto(new URL(sharedPath, base).toString(), {
      waitUntil: "domcontentloaded",
    });
    if (new URL(shared.url()).pathname !== sharedPath)
      throw new Error("Shared report redirected");
    await shared.locator("h1").first().waitFor();
    for (const width of [320, 375, 640, 768, 1280]) {
      currentCheck = `shared ${theme} ${width}`;
      await shared.setViewportSize({ width, height: 900 });
      const overflow = await shared.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      assert.ok(
        overflow <= 1,
        `shared ${theme} ${width}: horizontal overflow ${overflow}`,
      );
      const violations = (
        await new AxeBuilder({ page: shared })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations;
      assert.deepEqual(
        violations.map((violation) => violation.id),
        [],
        `shared ${theme} ${width}: axe`,
      );
      checks += 1;
    }
    const summary = shared.locator("details > summary").first();
    if (await summary.count()) {
      await summary.focus();
      const wasOpen = await summary.evaluate(
        (element) => element.parentElement.open,
      );
      await shared.keyboard.press("Escape");
      await summary.press("Enter");
      assert.equal(
        await summary.evaluate((element) => element.parentElement.open),
        !wasOpen,
      );
    }
    const pdf = await shared.pdf({ format: "A4", printBackground: true });
    assert.ok(pdf.length > 10000, "Shared PDF is empty");
    await writeFile(path.join(fixtureDir, `codex-shared-${theme}.pdf`), pdf, {
      mode: 0o600,
    });
    console.log(
      `PASS shared ${theme}: 320/375/640/768/1280 px, PDF ${pdf.length} bytes`,
    );
    await publicContext.close();
    await context.close();
  }
  console.log(`Private/report browser checks: ${checks} viewport cases passed`);
} catch (error) {
  const kind = error instanceof Error ? error.name : "UnknownError";
  console.error(`FAIL ${currentCheck}: ${kind}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

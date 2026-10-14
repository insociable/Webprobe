import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const base = new URL(process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3103");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
  "Instance locale requise",
);
const browser = await chromium.launch({ headless: true });

try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext();
    await context.addInitScript(
      (value) => localStorage.setItem("agency-monitor-theme", value),
      theme,
    );
    const page = await context.newPage();
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === base.hostname
        ? route.continue()
        : route.abort(),
    );
    for (const path of ["/", "/sign-in"]) {
      for (const width of [320, 375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(new URL(path, base).toString(), {
          waitUntil: "domcontentloaded",
        });
        await page.locator("h1").first().waitFor();
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          theme: document.documentElement.dataset.theme,
          targets: document.querySelectorAll("#contenu-principal").length,
          headings: document.querySelectorAll("h1").length,
        }));
        assert.equal(layout.theme, theme);
        assert.equal(layout.targets, 1);
        assert.equal(layout.headings, 1);
        assert.ok(
          layout.overflow <= 1,
          `${path} ${theme} ${width}px déborde de ${layout.overflow}px`,
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("href"),
          ),
          "#contenu-principal",
          `${path} ${theme} ${width}px : premier Tab`,
        );
        await page.keyboard.press("Enter");
        assert.equal(
          await page.evaluate(() => document.activeElement?.id),
          "contenu-principal",
        );
        if (width === 320 || width === 1280) {
          const audit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          assert.deepEqual(
            audit.violations.map((item) => item.id),
            [],
            `${path} ${theme} ${width}px : axe`,
          );
        }
      }
    }
    await context.close();
  }

  async function otpPage(status) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/auth/**", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(
          status === 200
            ? { success: true }
            : { message: "Erreur locale simulée" },
        ),
      }),
    );
    await page.goto(new URL("/sign-in", base).toString());
    await page
      .getByRole("textbox", { name: "Adresse e-mail" })
      .fill("test@example.invalid");
    await page.getByRole("button", { name: "Recevoir mon code" }).click();
    return { context, page };
  }

  const rejected = await otpPage(400);
  const email = rejected.page.getByRole("textbox", { name: "Adresse e-mail" });
  await rejected.page.locator("#signin-feedback").waitFor();
  assert.equal(
    await rejected.page.locator("#signin-feedback").getAttribute("role"),
    "alert",
  );
  assert.equal(await email.getAttribute("aria-invalid"), "true");
  assert.equal(await email.inputValue(), "test@example.invalid");
  await rejected.context.close();

  const accepted = await otpPage(200);
  await accepted.page
    .getByRole("textbox", { name: "Code à 6 chiffres" })
    .waitFor();
  assert.equal(
    await accepted.page.evaluate(() =>
      document.activeElement?.getAttribute("autocomplete"),
    ),
    "one-time-code",
  );
  await accepted.page
    .getByRole("button", { name: "Utiliser une autre adresse" })
    .click();
  assert.equal(
    await accepted.page.evaluate(() =>
      document.activeElement?.getAttribute("autocomplete"),
    ),
    "email",
  );
  await accepted.context.close();
  console.log(
    "Parcours publics, thèmes, reflow, clavier, axe et OTP simulé : OK",
  );
} finally {
  await browser.close();
}

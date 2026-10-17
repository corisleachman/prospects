import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
test("manual collection opens real run details and pairs the Runs screen with its prototype", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("coris@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goto("/runs");
  await expect(
    page.getByRole("checkbox", { name: "Include paid sources", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Run collection", exact: true })
    .click();
  await expect(page).toHaveURL(/\/runs\?run=/);
  await expect(
    page.getByRole("cell", { name: "Pending judging", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Done", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "trade press" });
  await row.getByRole("link").click();
  await expect(
    page.getByRole("heading", { name: "Sources and drops", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "too old: 1 · no date: 1 · duplicate: 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open source", exact: false }),
  ).toHaveAttribute("href", "https://example.test/news");
  await page.getByRole("link", { name: "All runs", exact: true }).click();
  const proto = await context.newPage(),
    dir = resolve("../../docs/signals-phase-6");
  await mkdir(dir, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: resolve(dir, "app-runs-" + width + ".png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await proto.goto("http://127.0.0.1:8790/prototype.html");
    await proto
      .getByRole("button", { name: "Runs and costs", exact: true })
      .click();
    await proto.screenshot({
      path: resolve(dir, "prototype-runs-" + width + ".png"),
      fullPage: true,
    });
  }
});

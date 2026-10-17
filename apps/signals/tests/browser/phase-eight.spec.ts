import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
test.afterEach(async ({ request }) => {
  await request.post("http://127.0.0.1:54329/fixture/cards", {
    data: { clear: true },
  });
});
test("Today keeps fresh rewrite versions, sends the visible one and moves feedback to history", async ({
  page,
  context,
  request,
}) => {
  await request.post("http://127.0.0.1:54329/fixture/cards", { data: {} });
  await page.goto("/login");
  await page.getByLabel("Email address").fill("manager@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  const card = page.locator(".signal-card").first();
  await expect(card).toContainText("Jordan Wells");
  await expect(page.locator(".signal-card").last()).toContainText("Sensitive");
  await card.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(card).toContainText("Version 2 of 2");
  await card.getByRole("button", { name: "Previous version" }).click();
  await expect(card).toContainText("Version 1 of 2");
  await card.getByRole("button", { name: "Next version" }).click();
  const dir = resolve("../../docs/signals-phase-8"),
    proto = await context.newPage();
  await mkdir(dir, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: resolve(dir, `app-today-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await proto.goto("http://127.0.0.1:8790/prototype.html");
    await proto.locator("#roleClient").click();
    await proto.screenshot({
      path: resolve(dir, `prototype-today-${width}.png`),
      fullPage: true,
    });
  }
  await card.getByRole("button", { name: "Mark sent", exact: true }).click();
  await expect(page.locator(".signal-card")).toHaveCount(2);
  const next = page.locator(".signal-card").first();
  await next.getByRole("button", { name: "Not relevant", exact: true }).click();
  await next.getByRole("button", { name: "Wrong person", exact: true }).click();
  await expect(page.locator(".signal-card")).toHaveCount(0);
  const events = await (
    await request.get("http://127.0.0.1:54329/fixture/card-events")
  ).json();
  expect(
    events.find((e: any) => e.p_action === "marked_sent").p_draft,
  ).toBeTruthy();
  await page
    .getByRole("link", { name: /^Sent and history/ })
    .click();
  await expect(page.getByText("Sent linkedin · Version 2")).toBeVisible();
  await expect(
    page.getByText("Not relevant · Wrong person", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download CSV", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: resolve(dir, `app-history-${width}.png`),
      fullPage: true,
    });
    await proto
      .getByRole("button", { name: /^Sent and history/ })
      .click();
    await proto.screenshot({
      path: resolve(dir, `prototype-history-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Mark replied", exact: true }).click();
  await expect(page.getByText("Replied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByText("Restored to Today", { exact: true }),
  ).toBeVisible();
});

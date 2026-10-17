import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
test("pipeline test review stays separate from client delivery and matches step seven", async ({
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
  await page.goto("/clients/10000000-0000-0000-0000-000000000001/setup?step=7");
  await expect(
    page.getByRole("heading", { name: "Test and go live" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Include paid news/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByText("£0.01", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Go live", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Review the 0 sample cards", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /I’ve reviewed/ }).click();
  await expect(
    page.getByRole("button", { name: "Go live", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Invite an active recipient",
  );
  const proto = await context.newPage(),
    dir = resolve("../../docs/signals-phase-7");
  await mkdir(dir, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: resolve(dir, `app-test-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await proto.goto("http://127.0.0.1:8790/prototype.html");
    await proto.getByRole("button", { name: "Setup", exact: true }).click();
    await proto.getByRole("button", { name: /Test and go live$/ }).click();
    await proto.screenshot({
      path: resolve(dir, `prototype-test-${width}.png`),
      fullPage: true,
    });
  }
});

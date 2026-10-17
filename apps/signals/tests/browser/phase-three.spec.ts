import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
const id = "10000000-0000-0000-0000-000000000001",
  path = "/clients/" + id + "/budget";
test("budget changes are recorded; fake costs spend and pause a test budget", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("coris@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goto(path);
  await page.getByLabel("Budget amount (£)", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Create budget", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test budget", exact: true }),
  ).toBeVisible();
  const topup = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Top up", exact: true }),
  });
  await topup.getByLabel("Amount to add (£)").fill("5");
  await topup.getByLabel("Note", { exact: true }).fill("A test top-up");
  await topup
    .getByRole("button", { name: "Add to budget", exact: true })
    .click();
  await expect(page.locator(".budget-totals dd").first()).toHaveText("£15.00");
  const change = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Change the total", exact: true }),
  });
  await change.getByLabel("Budget amount (£)").fill("10");
  await change
    .getByRole("button", { name: "Change budget", exact: true })
    .click();
  await expect(page.locator(".budget-totals dd").first()).toHaveText("£10.00");
  await page.getByLabel("Fake cost (£)", { exact: true }).fill("8");
  await page
    .getByRole("button", { name: "Add fake cost", exact: true })
    .click();
  await expect(page.getByText("80% · pending · 0 attempts")).toBeVisible();
  await page.getByLabel("Fake cost (£)", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Add fake cost", exact: true })
    .click();
  await expect(page.getByText(/Paused: budget used up on/)).toBeVisible();
  await expect(page.getByText("100% · pending · 0 attempts")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "A test top-up", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve("../../docs/signals-phase-3/budget-desktop.png"),
    fullPage: true,
  });
  await page.goto("/clients");
  await expect(
    page.getByText("Paused: budget used up", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "£0.00", exact: true }),
  ).toBeVisible();
  await page.goto(path);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("client roles cannot open budgets", async ({ page }) => {
  for (const email of ["client@example.test", "manager@example.test"]) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("correct-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Not allowed." }),
    ).toBeVisible();
    await page.goto("/today");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  }
});

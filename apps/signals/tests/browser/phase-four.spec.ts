import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
test("discovery estimates before approval, keeps polling and saves only checked companies and people", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("coris@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.getByRole("link", { name: "+ New client", exact: true }).click();
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Phase 4 search (test)");
  await page
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(page).toHaveURL(/\/setup\?step=1/);
  const path = new URL(page.url()).pathname.replace("/setup", "");
  await page.goto(path + "/setup?step=2");
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ICP profile", exact: true }),
  ).toBeVisible();
  await page.goto(path + "/budget");
  await page.getByLabel("Test budget · allows fake costs").uncheck();
  await page
    .getByRole("button", { name: "Create budget", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Usage budget", exact: true }),
  ).toBeVisible();
  await page.goto(path + "/find");
  await page.getByLabel("Company search keywords").fill("consumer");
  await page.getByLabel("Company search keywords").press("Enter");
  await page
    .getByRole("button", { name: "Estimate search cost", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Search estimate", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Maximum estimated cost: £0.10/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Company 0 (test) ↗", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Approve cost and find matches", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save watch list", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("checkbox", {
      name: "Keep company Company 0 (test)",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Keep company Company 0 (test)",
      exact: true,
    })
    .uncheck();
  await expect(
    page.getByRole("checkbox", {
      name: "Keep person Person 0 (test)",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Save watch list", exact: true })
    .click();
  await expect(
    page.getByText("Watch list saved.", { exact: true }),
  ).toBeVisible();
  const saved = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Saved watch list", exact: true }),
  });
  await expect(
    saved.getByRole("link", { name: "Company 0 (test) ↗", exact: true }),
  ).toHaveCount(0);
  await expect(
    saved.getByRole("link", { name: "Company 1 (test) ↗", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: resolve("../../docs/signals-phase-4/discovery-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

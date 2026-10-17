import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
}
test("signed-out users cannot open Clients or Today", async ({ page }) => {
  for (const path of ["/clients", "/today"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?/);
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  }
  await page.goto("/login");
  await page.screenshot({
    path: resolve("../../docs/signals-phase-1/login-desktop.png"),
    fullPage: true,
  });
});
test("admin signs in, creates a client and signs out", async ({ page }) => {
  await login(page, "coris@example.test");
  await expect(page).toHaveURL(/\/clients$/);
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "+ New client", exact: true }).click();
  await page.getByLabel("Client name").fill("New Client (test)");
  await page
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(page).toHaveURL(/\/setup\?step=1/);
  await page
    .getByRole("link", { name: "Clients", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "New Client (test)", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve("../../docs/signals-phase-1/clients-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test("client user sees Today and cannot browse admin or other client pages", async ({
  page,
  context,
}) => {
  await login(page, "client@example.test");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("No cards yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clients" })).toHaveCount(0);
  await page.goto("/clients");
  await expect(
    page.getByRole("heading", { name: "Not allowed." }),
  ).toBeVisible();
  await page.goto("/today?workspace=10000000-0000-0000-0000-000000000099");
  await expect(
    page.getByRole("heading", { name: "Not allowed." }),
  ).toBeVisible();
  await page.goto("/today");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("No cards yet", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve("../../docs/signals-phase-1/today-mobile.png"),
    fullPage: true,
  });
  const cookie = (await context.cookies()).find((c) =>
    c.name.includes("auth-token"),
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});
test("wrong credentials stay on login with a useful error; reset is non-enumerating", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Those details didn’t work",
  );
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole("heading", { name: "A fresh start." }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If there’s an account");
});
test("new invitation sets a password then explicitly accepts once", async ({
  page,
}) => {
  const invite = "a".repeat(64),
    next = encodeURIComponent("/set-password?invite=" + invite);
  await page.goto(
    "/auth/confirm?type=invite&token_hash=fixture-invite&next=" + next,
  );
  await expect(
    page.getByRole("heading", { name: "You’re invited." }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/set-password\?/);
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-new-password-123");
  await page.getByLabel("Confirm password").fill("a-new-password-123");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(
    page.getByRole("heading", { name: "Your workspace is ready." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText("No cards yet", { exact: true })).toBeVisible();
  await page.goto("/accept-invite?token=" + invite);
  await expect(
    page.getByRole("heading", { name: "Invitation unavailable." }),
  ).toBeVisible();
});
test("client admin also has no setup access", async ({ page }) => {
  await login(page, "manager@example.test");
  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByText("Your client’s cards.", { exact: false }),
  ).toBeVisible();
  await page.goto("/clients");
  await expect(
    page.getByRole("heading", { name: "Not allowed." }),
  ).toBeVisible();
});
test("password recovery confirms before updating, and consumed links fail", async ({
  page,
}) => {
  await page.goto(
    "/auth/confirm?type=recovery&token_hash=fixture-recovery&next=/set-password",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("New password", { exact: true })
    .fill("recovered-password-123");
  await page.getByLabel("Confirm password").fill("recovered-password-123");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto(
    "/auth/confirm?type=recovery&token_hash=fixture-recovery&next=/set-password",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "That link has expired",
  );
});

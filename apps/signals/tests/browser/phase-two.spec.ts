import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
const workspace = "10000000-0000-0000-0000-000000000001",
  path = "/clients/" + workspace;
async function login(page: Page, email = "coris@example.test") {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("setup autosaves optional criteria, restores tab-close edits, and enforces cap", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(path);
  await page.getByRole("button", { name: "Add profile", exact: true }).click();
  const editor = page.locator("section").filter({
    has: page.getByRole("heading", { name: "ICP profile", exact: true }),
  });
  await expect(
    editor.getByLabel("Profile name", { exact: true }),
  ).toBeVisible();
  await editor
    .getByLabel("Profile name", { exact: true })
    .fill("01B Consumer brands");
  await editor
    .getByLabel("Who do you want to reach?")
    .fill("Established US brands");
  await expect(editor.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(editor.getByLabel("Who do you want to reach?")).toHaveValue(
    "Established US brands",
  );
  await editor
    .getByLabel("Conversation to open")
    .fill("A draft saved when this tab closes");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(path);
  const restored = reopened.locator("section").filter({
    has: reopened.getByRole("heading", { name: "ICP profile", exact: true }),
  });
  await expect(restored.getByLabel("Conversation to open")).toHaveValue(
    "A draft saved when this tab closes",
  );
  await expect(restored.getByRole("status")).toHaveText("Saved");
  await reopened.getByLabel("Placeholder plan").selectOption("2");
  await expect(reopened.locator("#details").getByRole("status")).toHaveText(
    "Saved",
  );
  await reopened
    .getByRole("button", { name: "Add profile", exact: true })
    .click();
  await expect(
    reopened.getByText(
      "Profile limit reached. Choose a larger placeholder plan to add more.",
    ),
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Add profile", exact: true })
    .click();
  await expect(reopened.locator("p[role=alert]")).toContainText(
    "Profile limit reached",
  );
  await reopened.screenshot({
    path: resolve("../../docs/signals-phase-2/setup-desktop.png"),
    fullPage: true,
  });
  await reopened.setViewportSize({ width: 390, height: 844 });
  expect(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reopened.screenshot({
    path: resolve("../../docs/signals-phase-2/setup-mobile.png"),
    fullPage: true,
  });
});
test("client roles cannot open client setup URLs", async ({ page }) => {
  for (const email of ["client@example.test", "manager@example.test"]) {
    await login(page, email);
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Not allowed." }),
    ).toBeVisible();
    await page.goto("/today");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  }
});

test("named companies and range errors persist safely; stale tabs cannot overwrite", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(path);
  const editor = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "ICP profile", exact: true }),
    });
  await editor.getByRole("button", { name: "Add named company" }).click();
  await editor
    .getByLabel("Company name 1", { exact: true })
    .fill("Example brand");
  await editor.getByLabel("Website 1", { exact: true }).fill("example.test");
  await editor.getByLabel("Include parent", { exact: true }).check();
  await editor.getByLabel("Minimum revenue", { exact: true }).fill("100");
  await editor.getByLabel("Maximum revenue", { exact: true }).fill("50");
  await expect(editor.getByRole("alert")).toContainText(
    "minimum cannot exceed",
  );
  await editor.getByLabel("Maximum revenue", { exact: true }).fill("200");
  await expect(editor.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    editor.getByLabel("Include parent", { exact: true }),
  ).toBeChecked();
  const stale = await context.newPage();
  await stale.goto(path);
  await editor
    .getByLabel("Relevant moment", { exact: true })
    .fill("Latest saved priorities");
  await expect(editor.getByRole("status")).toHaveText("Saved");
  const staleEditor = stale
    .locator("section")
    .filter({
      has: stale.getByRole("heading", { name: "ICP profile", exact: true }),
    });
  await staleEditor
    .getByLabel("Relevant moment", { exact: true })
    .fill("An older tab should not win");
  await expect(staleEditor.getByRole("alert")).toContainText(
    "changed elsewhere",
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Relevant moment", exact: true }),
  ).toHaveValue("Latest saved priorities");
});

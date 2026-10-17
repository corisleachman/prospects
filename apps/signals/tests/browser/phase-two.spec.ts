import { test, expect, type Page } from "@playwright/test";
const workspace = "10000000-0000-0000-0000-000000000001",
  path = "/clients/" + workspace + "/setup?step=2";
async function login(page: Page, email = "coris@example.test") {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("setup autosaves chip filters, restores drafts and enforces plan caps", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(path);
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await page
    .getByLabel("Profile name", { exact: true })
    .fill("Consumer brands");
  await page.getByLabel("Profile code", { exact: true }).fill("01B");
  await page
    .getByLabel("Who do you want to reach?", { exact: true })
    .fill("Established US consumer brands");
  await page
    .getByLabel("Industries", { exact: true })
    .fill("not a real industry");
  await page.getByLabel("Industries", { exact: true }).press("Enter");
  await expect(
    page.getByText("Choose a value from the suggestions.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Industries", { exact: true })
    .fill("Consumer Goods,Food and Beverage Manufacturing");
  await page
    .getByLabel("Priority job titles", { exact: true })
    .fill("CMO,Brand Director,CMO");
  await expect(
    page.getByRole("button", {
      name: "Remove Priority job titles: CMO",
      exact: true,
    }),
  ).toHaveCount(1);
  await page.getByLabel("Locations", { exact: true }).fill("United States");
  await page.getByLabel("Locations", { exact: true }).press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Remove Industries: Consumer Goods",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Conversation to open", { exact: true })
    .fill("A specific reason to connect about their new marketing priorities.");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(path);
  await expect(
    reopened.getByLabel("Conversation to open", { exact: true }),
  ).toHaveValue(
    "A specific reason to connect about their new marketing priorities.",
  );
  await expect(reopened.getByRole("status")).toHaveText("Saved");
  await reopened.goto("/clients/" + workspace + "/setup?step=1");
  await reopened.getByLabel("Placeholder plan").selectOption("2");
  await expect(reopened.getByRole("status")).toHaveText("Saved");
  await reopened.goto(path);
  await reopened.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(
    reopened.getByText(
      "Profile limit reached. Choose a larger placeholder plan to add more.",
    ),
  ).toBeVisible();
  await reopened.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(reopened.locator("p[role=alert]")).toContainText(
    "Profile limit reached",
  );
});
test("client roles cannot open overview, setup, global budgets or runs", async ({
  page,
}) => {
  for (const email of ["client@example.test", "manager@example.test"]) {
    await login(page, email);
    for (const target of ["/clients/" + workspace, path, "/budgets", "/runs"]) {
      await page.goto(target);
      await expect(
        page.getByRole("heading", { name: "Not allowed." }),
      ).toBeVisible();
    }
    await page.goto("/today");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  }
});
test("named chips, range errors and stale tabs retain their protections", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(path);
  await page
    .getByLabel("Also watch these companies or brands", { exact: true })
    .fill("example.test,Example brand");
  await page
    .getByLabel("Revenue (USD) from", { exact: true })
    .selectOption("50000000");
  await page
    .getByLabel("Revenue (USD) to", { exact: true })
    .selectOption("10000000");
  await expect(page.getByText("To must be at least From.")).toBeVisible();
  await page
    .getByLabel("Revenue (USD) to", { exact: true })
    .selectOption("100000000");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Remove Also watch these companies or brands: https://example.test/",
      exact: true,
    }),
  ).toBeVisible();
  const stale = await context.newPage();
  await stale.goto(path);
  await page
    .getByLabel("Relevant moment", { exact: true })
    .fill("Latest saved priorities");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await stale
    .getByLabel("Relevant moment", { exact: true })
    .fill("An older tab should not win");
  await expect(stale.locator("p[role=alert]")).toContainText(
    "changed elsewhere",
  );
  await page.reload();
  await expect(page.getByLabel("Relevant moment", { exact: true })).toHaveValue(
    "Latest saved priorities",
  );
});

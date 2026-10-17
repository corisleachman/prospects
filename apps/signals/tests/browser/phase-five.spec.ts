import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
let w = "",
  base = "";
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("coris@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
}
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext(),
    page = await context.newPage();
  await login(page);
  await page.getByRole("link", { name: "+ New client", exact: true }).click();
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Phase 5 setup (test)");
  await page
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(page).toHaveURL(/\/setup\?step=1/);
  w = new URL(page.url()).pathname.split("/")[2];
  base = "/clients/" + w + "/setup?step=";
  await page.goto(base + "2");
  for (const [code, name] of [
    ["01B", "Established growth brands"],
    ["02", "Search consultants"],
  ]) {
    await page.getByRole("button", { name: "+ Add", exact: true }).click();
    await page.getByLabel("Profile code", { exact: true }).fill(code);
    await page.getByLabel("Profile name", { exact: true }).fill(name);
    await expect(page.getByRole("status")).toHaveText("Saved");
  }
  await context.close();
});
test("rule edits preserve raw keywords, scope and sensitive polarity; voice autosaves", async ({
  page,
}) => {
  await login(page);
  await page.goto(base + "3");
  await expect(
    page.getByRole("heading", { name: "Signals", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Enable Layoffs or restructure", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "+ Add signal", exact: true }).click();
  const edit = page.locator(".rule-editor");
  await edit.getByLabel("Name", { exact: true }).fill("Agency phrases (test)");
  await edit.getByLabel("Type", { exact: true }).selectOption("negative");
  await edit
    .getByLabel("What counts", { exact: false })
    .fill("A live agency review or search.");
  await edit
    .getByLabel("Keywords", { exact: true })
    .fill('"agency of record",agency review,-recruitment');
  await expect(edit.locator(".keyword-exact")).toContainText(
    "agency of record",
  );
  await expect(edit.locator(".keyword-exclude")).toContainText("-recruitment");
  await edit.getByRole("button", { name: "01B", exact: true }).click();
  await edit.getByRole("button", { name: "02", exact: true }).click();
  await edit.getByRole("button", { name: "Save signal", exact: true }).click();
  await expect(
    page.locator(".rule-row").filter({ hasText: "Agency phrases (test)" }),
  ).toContainText("Negative");
  await page.reload();
  const rule = page
    .locator(".rule-row")
    .filter({ hasText: "Agency phrases (test)" });
  await expect(rule).toContainText("Profiles: 01B, 02");
  await rule.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Keywords", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(base + "5");
  await page
    .getByLabel("Real example messages", { exact: false })
    .fill(
      "Hi Alex, I saw the new campaign. Good to connect.\n---\nHi Jordan, congratulations on the new role. Thought it would be good to connect.\n---\nHi Morgan, I saw your post about pitch practice. Thought it would be good to connect.",
    );
  await page.getByLabel("Sign-off", { exact: true }).fill("Best, Alex");
  await page
    .getByLabel("Never say", { exact: true })
    .fill("synergy,game-changing");
  await page.getByLabel("LinkedIn length", { exact: true }).selectOption("200");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("LinkedIn length", { exact: true })).toHaveValue(
    "200",
  );
  await expect(
    page.getByRole("button", {
      name: "Remove Never say: synergy",
      exact: true,
    }),
  ).toBeVisible();
});
test("sources autosave windows and recipients use the real invite action with a local mail sink", async ({
  page,
}) => {
  await login(page);
  await page.goto(base + "4");
  const source = page.locator(".source-row").filter({ hasText: "Trade press" });
  await source
    .getByLabel("Trade press freshness", { exact: true })
    .selectOption("72");
  await expect(source.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByLabel("Trade press freshness", { exact: true }),
  ).toHaveValue("72");
  await page.goto(base + "6");
  await page
    .getByRole("button", { name: "+ Invite person", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Alex Example");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("alex@example.test");
  await page
    .getByRole("button", { name: "Add and invite", exact: true })
    .click();
  await expect(
    page.getByText("alex@example.test", { exact: false }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "alex@example.test" });
  await expect(row).toContainText("invite sent");
  await row
    .getByRole("button", {
      name: "Receive 01B for alex@example.test",
      exact: true,
    })
    .click();
  await row
    .getByRole("button", {
      name: "Receive 02 for alex@example.test",
      exact: true,
    })
    .click();
  await row
    .getByLabel("Morning email for alex@example.test", { exact: true })
    .selectOption("08:00");
  await row.getByText("Limits", { exact: true }).click();
  await row
    .getByRole("checkbox", {
      name: "Override daily card cap for alex@example.test",
      exact: true,
    })
    .check();
  await row
    .getByLabel("Daily card cap for alex@example.test", { exact: true })
    .fill("5");
  await expect(row.getByRole("status")).toHaveText("Saved");
  const defaults = page.locator(".client-limits");
  await defaults
    .getByLabel("Cards per person per day", { exact: true })
    .fill("15");
  await defaults.getByLabel("Repeat window (days)", { exact: true }).fill("45");
  await expect(defaults.getByRole("status")).toHaveText("Saved");
  await expect(row).toContainText("5 a day (custom) · 45 days");
  await page.reload();
  const saved = page.getByRole("row").filter({ hasText: "alex@example.test" });
  await expect(
    saved.getByRole("button", {
      name: "Receive 01B for alex@example.test",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    saved.getByLabel("Morning email for alex@example.test", { exact: true }),
  ).toHaveValue("08:00");
});
test("phase 5 desktop and mobile screens sit beside the matching prototype views", async ({
  page,
  context,
}) => {
  await login(page);
  const proto = await context.newPage(),
    dir = resolve("../../docs/signals-phase-5");
  await mkdir(dir, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    for (const [name, step] of [
      ["signals", 3],
      ["sources", 4],
      ["voice", 5],
      ["routing", 6],
    ] as const) {
      await page.goto(base + step);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(dir, `app-${name}-${width}.png`),
        fullPage: true,
      });
      await proto.goto("http://127.0.0.1:8790/prototype.html");
      await proto.getByRole("button", { name: "Setup", exact: true }).click();
      await proto
        .getByRole("button", {
          name: {
            signals: /Signals$/,
            sources: /Sources$/,
            voice: /Voice and copy$/,
            routing: /Who gets what$/,
          }[name],
        })
        .click();
      await proto.screenshot({
        path: resolve(dir, `prototype-${name}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

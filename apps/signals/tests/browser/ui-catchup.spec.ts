import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("../../docs/signals-ui-catchup"),
  w = "10000000-0000-0000-0000-000000000001";
test("catch-up matches prototype structure at 1280 and 390, including real chip mappings", async ({
  page,
  context,
}) => {
  await mkdir(root, { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Email address").fill("coris@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const discoveryPath = await page
    .getByRole("link", { name: "Phase 4 search (test)", exact: true })
    .getAttribute("href");
  const proto = await context.newPage();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await proto.setViewportSize({ width, height: 900 });
    for (const [name, path] of [
      ["clients", "/clients"],
      ["new-client", "/clients/new"],
      ["overview", "/clients/" + w],
      ["details", "/clients/" + w + "/setup?step=1"],
      ["profiles", "/clients/" + w + "/setup?step=2"],
      ["budgets", "/budgets"],
      ["find", discoveryPath + "/find"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(root, `app-${name}-${width}.png`),
        fullPage: true,
      });
      await proto.goto("http://127.0.0.1:8790/prototype.html");
      if (name === "overview")
        await proto
          .getByRole("button", { name: "Before: Work", exact: true })
          .click();
      if (
        name === "details" ||
        name === "profiles" ||
        name === "find" ||
        name === "new-client"
      ) {
        await proto.getByRole("button", { name: "Setup", exact: true }).click();
        if (name === "profiles" || name === "find")
          await proto
            .getByRole("button", { name: "ICP profiles", exact: false })
            .click();
      }
      if (name === "find") {
        await proto
          .getByRole("button", { name: "Find matches", exact: true })
          .click();
        await expect(proto.getByText(/companies and about/)).toBeVisible();
      }
      if (name === "budgets")
        await proto
          .getByRole("button", { name: "Budgets", exact: true })
          .click();
      await proto.screenshot({
        path: resolve(root, `prototype-${name}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.goto("/clients/" + w + "/setup?step=2");
  await expect(
    page.getByRole("button", { name: /Signals.*Coming in Phase 5/ }),
  ).toBeDisabled();
  await page
    .getByLabel("Locations", { exact: true })
    .fill("California (US state),New York metro (city keyword)");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Remove Locations: California (US state)",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/clients/" + w);
  await page.getByRole("link", { name: "View as client", exact: true }).click();
  await expect(page.getByText(/Viewing as Before: Work/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Budgets", exact: true }),
  ).toHaveCount(0);
});

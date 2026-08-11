import { expect, test } from "@playwright/test";

test("sidebar navigates every workspace view", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Which implementation will age better?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Future Scenarios" }).click();
  await expect(page.getByRole("heading", { name: "Future Scenarios" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Future Scenarios" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Experiments" }).click();
  await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();

  await page.getByRole("button", { name: "Comparisons" }).click();
  await expect(page.getByRole("heading", { name: "Candidate Comparison" })).toBeVisible();

  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Runtime Settings" })).toBeVisible();

  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Which implementation will age better?" })).toBeVisible();
});

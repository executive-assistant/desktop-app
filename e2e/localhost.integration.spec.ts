import { expect, test } from "@playwright/test";

test.describe("localhost integration", () => {
  test.skip(!process.env.LOCALHOST_E2E, "Set LOCALHOST_E2E=1 to run real localhost integration tests.");

  test("real backend: chat request succeeds without route mocking", async ({ page, request }) => {
    const healthUrl = process.env.LOCALHOST_E2E_HEALTH_URL ?? "http://127.0.0.1:8000/health";
    const profileBaseUrl = process.env.LOCALHOST_E2E_PROFILE_BASE_URL ?? "http://127.0.0.1:4173/api";

    const health = await request.get(healthUrl, { timeout: 5_000 });
    expect(health.ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ken Desktop POC" })).toBeVisible();

    await page.getByRole("button", { name: "New" }).click();
    await page.getByLabel("Name").fill("Localhost Proxy");
    await page.getByLabel("Type").selectOption("local_dev");
    await page.getByLabel("Base URL").fill(profileBaseUrl);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".sidebar .panel").first().locator(".profile-list")).toContainText(
      "Localhost Proxy"
    );

    const prompt = `localhost integration ping ${Date.now()}`;
    await page.getByPlaceholder("Send a message to /message endpoint").fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();

    const assistantMessage = page.locator(".assistant-message").last();
    await expect(assistantMessage.locator(".status-pill")).toContainText("done", { timeout: 60_000 });
    await expect(assistantMessage.locator("pre")).not.toHaveText(/^$/, { timeout: 60_000 });

    const timelineItem = page.locator(".timeline-item", { hasText: "request_message" }).last();
    await expect(timelineItem).toContainText("success", { timeout: 60_000 });
  });
});

import { expect, test } from "@playwright/test";

test("critical path: profile + auth + streaming chat", async ({ page }) => {
  let authorizationHeader = "";

  await page.route("http://127.0.0.1:8000/message", async (route) => {
    authorizationHeader = route.request().headers().authorization ?? "";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "access-control-allow-origin": "*"
      },
      body: 'data: {"delta":"Hello"}\n\ndata: {"delta":" world"}\n\ndata: [DONE]\n\n'
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ken Desktop POC" })).toBeVisible();

  await page.getByRole("button", { name: "New" }).click();
  await page.getByLabel("Name").fill("Remote QA");
  await page.getByLabel("Type").selectOption("remote");
  await page.getByLabel("Base URL").fill("https://ken.example.com");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".profile-list")).toContainText("Remote QA");

  const localDevItem = page.locator(".profile-item", { hasText: "Local Dev" });
  await localDevItem.getByRole("button", { name: "Select" }).click();

  await page.getByLabel("Access Token").fill("token-e2e");
  await page.getByLabel("Refresh Token (optional)").fill("refresh-e2e");
  await page.getByRole("button", { name: "Save Tokens" }).click();
  await expect(page.getByText("Tokens saved.")).toBeVisible();

  await page.getByPlaceholder("Send a message to /message endpoint").fill("Hello Ken");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".assistant-message").last()).toContainText("Hello world");
  await expect(page.locator(".timeline-item", { hasText: "request_message" })).toContainText("success");
  await expect.poll(() => authorizationHeader).toContain("Bearer token-e2e");

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByText("Tokens cleared.")).toBeVisible();
  await expect(page.getByText("Stored token status:")).toContainText("Missing");
});

test("failure path: server 500 marks assistant and timeline as error", async ({ page }) => {
  await page.route("http://127.0.0.1:8000/message", async (route) => {
    await route.fulfill({
      status: 500,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      },
      body: JSON.stringify({
        error: "internal_error"
      })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ken Desktop POC" })).toBeVisible();

  await page.getByPlaceholder("Send a message to /message endpoint").fill("This should fail");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantMessage = page.locator(".assistant-message").last();
  await expect(assistantMessage).toContainText("error");
  await expect(assistantMessage).toContainText("Server returned 500");

  const timelineItem = page.locator(".timeline-item", { hasText: "request_message" }).last();
  await expect(timelineItem).toContainText("error");
  await expect(timelineItem).toContainText("Server returned 500");
});

test("approval path: backend signal blocks send until user approves", async ({ page }) => {
  let approvalBody = "";

  await page.route("http://127.0.0.1:8000/message", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "access-control-allow-origin": "*"
      },
      body: [
        "event: approval_required",
        'data: {"approval_required":true,"approval_id":"appr-e2e-1","action":"delete_file","detail":"Delete README.md?"}',
        "data: [DONE]",
        ""
      ].join("\n")
    });
  });

  await page.route("http://127.0.0.1:8000/approval", async (route) => {
    approvalBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*"
      },
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ken Desktop POC" })).toBeVisible();

  await page.getByPlaceholder("Send a message to /message endpoint").fill("trigger approval");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("heading", { name: "Approval Required" })).toBeVisible();
  await expect(page.getByText("Action:")).toContainText("delete_file");

  const sendButton = page.getByRole("button", { name: "Approval Pending" });
  await expect(sendButton).toBeDisabled();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => approvalBody).toContain('"approval_id":"appr-e2e-1"');
  await expect.poll(() => approvalBody).toContain('"decision":"approve"');

  await expect(page.getByRole("heading", { name: "Approval Required" })).toHaveCount(0);
  await expect(page.locator(".timeline-item", { hasText: "approval_required" }).last()).toContainText("success");
  await expect(page.locator(".timeline-item", { hasText: "approval_decision" }).last()).toContainText("success");
});

test("recovery path: persisted streaming message is restored as interrupted", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const key = "ken.desktop.chat.v1.local-dev";
    const now = new Date().toISOString();
    const payload = [
      {
        id: "user-1",
        role: "user",
        content: "hello",
        createdAt: now,
        status: "done"
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "partial reply",
        createdAt: now,
        status: "streaming"
      }
    ];
    localStorage.setItem(key, JSON.stringify(payload));
  });

  await page.reload();
  await expect(page.getByText("Recovered partial assistant output from an interrupted stream.")).toBeVisible();

  const assistantMessage = page.locator(".assistant-message", { hasText: "partial reply" }).first();
  await expect(assistantMessage).toContainText("interrupted");
  await expect(assistantMessage).toContainText("Stream was interrupted. Partial output was recovered.");
});

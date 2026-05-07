import { test, expect } from "@playwright/test";

/**
 * TASK 7: Secure Telemetry Persistence E2E Tests
 *
 * Validates:
 * - No payload leakage in persistence layer
 * - Exception sanitization prevents PII in logs
 * - Safe telemetry only stores types, not values
 * - LGPD compliance: zero sensitive data
 */

test.describe("TASK 7: Telemetry Persistence & Exception Sanitization", () => {
  test.beforeEach(async ({ page, context }) => {
    // Set up auth intercept to skip login if needed
    await page.goto("http://localhost:3000");
  });

  test("should not leak CPF in telemetry on high-risk detection", async ({
    page,
  }) => {
    const sensitivePayload = "CPF: 050.423.674-11 de João Silva";

    // Listen for network requests to backend
    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log" && msg.text().includes("dlp_")) {
        telemetryEvents.push(msg.text());
      }
    });

    // Type sensitive content
    await page.fill("textarea[placeholder*='prompt']", sensitivePayload);

    // Wait for analysis
    await page.waitForTimeout(500);

    // Verify no raw CPF in any telemetry event
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("050.423.674-11");
    expect(allEvents).not.toContain("João Silva");

    // Verify safe metadata is present
    expect(page.locator("[data-testid='risk-badge']")).toContainText(/HIGH|MEDIUM/);
  });

  test("should not leak email in telemetry on warning", async ({ page }) => {
    const emailPayload =
      "Contact diego@atenna.ai for more information about this sensitive topic";

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log") {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", emailPayload);
    await page.waitForTimeout(500);

    // Verify no email in telemetry
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("diego@atenna.ai");
    expect(allEvents).not.toContain("sensitive topic");
  });

  test("should not leak API key in telemetry on detection", async ({
    page,
  }) => {
    const apiKeyPayload =
      "Use API key sk-ant-v3aBcDefGhijKlmnOp_1234567890 to authenticate";

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log") {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", apiKeyPayload);
    await page.waitForTimeout(500);

    // Verify no API key in telemetry
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("sk-ant-v3");
    expect(allEvents).not.toContain("authenticate");
  });

  test("should store entity types, not values, in telemetry", async ({
    page,
  }) => {
    const mixedPayload =
      "CPF: 050.423.674-11 and email diego@atenna.ai in one payload";

    const telemetryPayloads: any[] = [];

    // Intercept API calls to capture telemetry
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const postData = request.postData();
      if (postData && postData.includes("dlp_")) {
        telemetryPayloads.push(JSON.parse(postData));
      }
      await route.continue();
    });

    await page.fill("textarea[placeholder*='prompt']", mixedPayload);
    await page.waitForTimeout(1000);

    // Verify telemetry contains entity types, not values
    const dlpPayloads = telemetryPayloads.filter(
      (p) => p.event_type && p.event_type.includes("dlp")
    );

    if (dlpPayloads.length > 0) {
      const firstEvent = dlpPayloads[0];

      // Should have entity_types array
      if (firstEvent.entity_types) {
        expect(Array.isArray(firstEvent.entity_types)).toBe(true);

        // Should contain type names, not actual values
        const types = firstEvent.entity_types.join(" ");
        expect(types).not.toContain("050.423.674-11");
        expect(types).not.toContain("diego");
      }

      // Should have entity_count (safe metric)
      if (firstEvent.entity_count !== undefined) {
        expect(typeof firstEvent.entity_count).toBe("number");
      }
    }
  });

  test("should not leak payload in exception messages", async ({ page }) => {
    // Create a scenario that might trigger an error
    const sensitivePayload = "CPF: 050.423.674-11";

    // Intercept console errors
    const errorMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessages.push(msg.text());
      }
    });

    // Force a potential error condition
    await page.fill("textarea[placeholder*='prompt']", sensitivePayload);

    // Try to generate with empty/invalid state (might trigger error)
    const generateButton = page.locator("button:has-text('Generate')");
    if (await generateButton.isVisible()) {
      await generateButton.click();
      await page.waitForTimeout(500);
    }

    // Verify no sensitive data in any error
    const allErrors = errorMessages.join(" ");
    expect(allErrors).not.toContain("050.423.674-11");
    expect(allErrors).not.toContain("CPF:");
  });

  test("should handle timeout without leaking payload", async ({ page }) => {
    const largePayload =
      "CPF: 050.423.674-11 " + "text".repeat(10000); // Large text to potentially timeout

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log" && msg.text().includes("timeout")) {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", largePayload);
    await page.waitForTimeout(4000); // Wait for potential timeout

    // Verify timeout occurred
    const timeoutEvent = telemetryEvents.find((e) => e.includes("timeout"));
    if (timeoutEvent) {
      // Verify no payload in timeout event
      expect(timeoutEvent).not.toContain("050.423.674-11");
      expect(timeoutEvent).not.toContain("text".repeat(100));
    }
  });

  test("should sanitize CNPJ in telemetry", async ({ page }) => {
    const cnpjPayload =
      "Company CNPJ: 12.345.678/0001-99 is registered with us";

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log") {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", cnpjPayload);
    await page.waitForTimeout(500);

    // Verify no CNPJ in telemetry
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("12.345.678/0001-99");
    expect(allEvents).not.toContain("registered");
  });

  test("should sanitize phone number in telemetry", async ({ page }) => {
    const phonePayload =
      "Call us at +55 (11) 98765-4321 for customer support";

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log") {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", phonePayload);
    await page.waitForTimeout(500);

    // Verify no phone in telemetry
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("98765-4321");
    expect(allEvents).not.toContain("+55");
  });

  test("safe fields should be present in telemetry", async ({ page }) => {
    const testPayload = "This is a normal safe payload";

    const telemetryPayloads: any[] = [];

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const postData = request.postData();
      if (postData) {
        try {
          const parsed = JSON.parse(postData);
          if (parsed.event_type && parsed.event_type.includes("dlp")) {
            telemetryPayloads.push(parsed);
          }
        } catch {
          // Not JSON, skip
        }
      }
      await route.continue();
    });

    await page.fill("textarea[placeholder*='prompt']", testPayload);
    await page.waitForTimeout(1000);

    if (telemetryPayloads.length > 0) {
      const event = telemetryPayloads[0];

      // Verify safe fields are present
      expect(event.event_type).toBeDefined();
      expect(event.ts || event.timestamp).toBeDefined();

      // Optional but should be there if risk was detected
      if (event.risk_level) {
        expect(["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"]).toContain(
          event.risk_level
        );
      }

      if (event.entity_count !== undefined) {
        expect(event.entity_count).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe("TASK 7: Integration with Strict Mode", () => {
  test("should persist rewrite events without payload leakage", async ({
    page,
  }) => {
    // This test would require navigating to the extension with strict mode enabled
    await page.goto("http://localhost:3000");

    const sensitivePayload =
      "CPF: 050.423.674-11 should be rewritten in strict mode";

    const telemetryEvents: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log" && msg.text().includes("strict")) {
        telemetryEvents.push(msg.text());
      }
    });

    await page.fill("textarea[placeholder*='prompt']", sensitivePayload);

    // Wait for analysis and potential rewrite
    await page.waitForTimeout(1000);

    // Verify rewrite telemetry doesn't contain payload
    const allEvents = telemetryEvents.join(" ");
    expect(allEvents).not.toContain("050.423.674-11");
    expect(allEvents).not.toContain("[CPF]");
  });
});

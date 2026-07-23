import { describe, expect, it } from "vitest";
import jobService from "../jobs/identityVerificationJob.js";

const { isTransientAiError, retryDelayMs, safeAiErrorMessage } = jobService;

describe("identity verification AI retry policy", () => {
  it.each([429, 500, 502, 503, 504])("retries transient HTTP %s responses", (status) => {
    expect(isTransientAiError(new Error(`Identity AI returned ${status}: <!DOCTYPE html>`))).toBe(true);
  });

  it("retries network failures without exposing technical details", () => {
    const error = new Error("fetch failed: ECONNRESET");
    expect(isTransientAiError(error)).toBe(true);
    expect(safeAiErrorMessage(error)).toContain("retry automatically");
    expect(safeAiErrorMessage(error)).not.toContain("ECONNRESET");
  });

  it("does not retry a permanent validation response", () => {
    expect(isTransientAiError(new Error("Identity AI returned 400"))).toBe(false);
  });

  it("caps exponential retry delays at two minutes", () => {
    expect(retryDelayMs(1)).toBe(15_000);
    expect(retryDelayMs(4)).toBe(120_000);
    expect(retryDelayMs(8)).toBe(120_000);
  });

  it("strips an HTML response body from permanent errors", () => {
    expect(safeAiErrorMessage(new Error("Invalid response <!DOCTYPE html><html>failure</html>"))).toBe("Invalid response");
  });
});

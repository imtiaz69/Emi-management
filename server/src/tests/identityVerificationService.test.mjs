import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildDecision } = require("../services/identityVerificationService");

function observation(overrides = {}) {
  return {
    ocr: {
      status: "COMPLETED",
      rawText: "Name: Md Rahim Uddin NID: 1234567890 DOB: 15/05/1998",
      fields: { name: "MD RAHIM UDDIN", nidNumber: "১২৩৪৫৬৭৮৯০", dateOfBirth: "15/05/1998" },
      confidence: 0.94,
      warnings: []
    },
    qr: {
      status: "DECODED",
      rawData: '{"name":"Md Rahim Uddin"}',
      fields: { name: "Md Rahim Uddin", nidNumber: "1234567890", dateOfBirth: "1998-05-15" }
    },
    comparisons: { nameSimilarity: 0.97 },
    profileFields: { name: "Md Rahim Uddin", nidNumber: "1234567890", dateOfBirth: "1998-05-15" },
    face: { detected: true, qualityAcceptable: true, similarity: 0.72, warnings: [] },
    liveness: { status: "PASS", warnings: [] },
    modelVersions: { faceRecognizer: "test" },
    ...overrides
  };
}

describe("identity verification policy", () => {
  it("verifies matching OCR, QR, face, and liveness observations", () => {
    const result = buildDecision(observation(), "video");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.checks.nidNumberMatch.status).toBe("PASS");
    expect(result.fieldComparisons.nidNumber.front).toBe("******7890");
    expect(result.automatedDecision).toBe("approved");
  });

  it("fails an explicit NID mismatch without hiding the reason", () => {
    const changed = observation();
    changed.qr.fields.nidNumber = "9999999999";
    const result = buildDecision(changed, "video");
    expect(result.overallStatus).toBe("FAILED");
    expect(result.checks.nidNumberMatch.status).toBe("FAIL");
    expect(result.failureReasons.join(" ")).toContain("NID number");
  });

  it("keeps unreadable QR data for manual review", () => {
    const changed = observation({ qr: { status: "QR_DATA_NOT_PARSEABLE", rawData: "opaque", fields: {} } });
    const result = buildDecision(changed, "video");
    expect(result.overallStatus).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.checks.qrDecoded.status).toBe("INCONCLUSIVE");
  });

  it("limits selfie fallback to partial verification", () => {
    const result = buildDecision(observation(), "selfie");
    expect(result.overallStatus).toBe("PARTIALLY_VERIFIED");
    expect(result.checks.liveness.status).toBe("NOT_AVAILABLE");
  });

  it("verifies matching front OCR and buyer profile without QR or face evidence", () => {
    const result = buildDecision(observation({
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      face: { detected: false, qualityAcceptable: false, similarity: 0, warnings: [] },
      liveness: { status: "NOT_AVAILABLE", warnings: [] }
    }), "document_only");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.checks.faceMatch.status).toBe("NOT_AVAILABLE");
    expect(result.checks.liveness.status).toBe("NOT_AVAILABLE");
    expect(result.checks.qrDecoded.status).toBe("NOT_AVAILABLE");
    expect(result.automatedDecision).toBe("approved");
  });

  it("rejects a document-only check when a required field mismatches", () => {
    const changed = observation();
    changed.profileFields.dateOfBirth = "2000-01-01";
    const result = buildDecision(changed, "document_only");
    expect(result.overallStatus).toBe("FAILED");
    expect(result.automatedDecision).toBe("rejected");
    expect(result.failureReasons[0]).toContain("buyer profile");
  });

  it("rejects verification when completed profile identity data differs from the NID", () => {
    const result = buildDecision(observation({
      profileFields: { name: "Another Person", nidNumber: "1234567890", dateOfBirth: "1998-05-15" }
    }), "document_only");
    expect(result.overallStatus).toBe("FAILED");
    expect(result.checks.profileNameMatch.status).toBe("FAIL");
    expect(result.failureReasons.join(" ")).toContain("account name");
  });
});

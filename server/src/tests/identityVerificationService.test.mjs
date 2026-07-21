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

  it("verifies a buyer NID selfie when face similarity reaches 60 percent", () => {
    const result = buildDecision(observation({
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      face: { detected: true, qualityAcceptable: true, similarity: 0.6, warnings: [] },
      liveness: { status: "NOT_AVAILABLE", warnings: [] }
    }), "document_selfie");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.checks.faceMatch.status).toBe("PASS");
    expect(result.scores.faceSimilarity).toBe(0.6);
  });

  it("reports an optional selfie below 60 percent without blocking valid NID approval", () => {
    const result = buildDecision(observation({
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      face: { detected: true, qualityAcceptable: true, similarity: 0.59, warnings: [] },
      liveness: { status: "NOT_AVAILABLE", warnings: [] }
    }), "document_selfie");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.checks.faceMatch.status).toBe("FAIL");
    expect(result.warnings.join(" ")).toContain("60% similarity");
  });

  it("accepts a 67 percent lowercase OCR name when exact NID and DOB corroborate it", () => {
    const result = buildDecision(observation({
      ocr: {
        status: "COMPLETED",
        rawText: "Name: IMTJAZ MER Date of Birth 31 Dec 2002 ID NO 6463188984",
        fields: { name: "IMTJAZ MER", nidNumber: "6463188984", dateOfBirth: "2002-12-31" },
        confidence: 0.52,
        warnings: []
      },
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      profileFields: { name: "imtiaz ahmed", nidNumber: "6463188984", dateOfBirth: "2002-12-31" },
      face: { detected: false, qualityAcceptable: false, similarity: 0, warnings: [] },
      liveness: { status: "NOT_AVAILABLE", warnings: [] }
    }), "document_only");
    expect(result.scores.profileNameSimilarity).toBeGreaterThanOrEqual(0.6);
    expect(result.checks.profileNameMatch.status).toBe("PASS");
    expect(result.checks.profileNameMatch.detail).toContain("lowercase OCR similarity");
    expect(result.checks.profileNameMatch.detail).toContain("exact NID number and date of birth");
    expect(result.overallStatus).toBe("VERIFIED");
  });

  it("does not use the relaxed OCR name threshold when DOB is missing", () => {
    const result = buildDecision(observation({
      ocr: { status: "COMPLETED", rawText: "Name: IMTJAZ MER ID NO 6463188984", fields: { name: "IMTJAZ MER", nidNumber: "6463188984" }, confidence: 0.52, warnings: [] },
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      profileFields: { name: "Imtiaz Ahmed", nidNumber: "6463188984", dateOfBirth: "2002-12-31" }
    }), "document_only");
    expect(result.checks.profileDateOfBirthMatch.status).toBe("INCONCLUSIVE");
    expect(result.checks.profileNameMatch.status).not.toBe("PASS");
    expect(result.overallStatus).toBe("FAILED");
  });

  it.each(["TAFI SHEIKH", "tafi sheikh", "Tafi Sheikh", "tAfI sHeIkH"])(
    "matches profile names regardless of letter case: %s",
    (profileName) => {
      const changed = observation({
        ocr: {
          status: "COMPLETED",
          fields: { name: "TAFI SHEIKH", nidNumber: "63849492839", dateOfBirth: "07 Jan 2002" },
          confidence: 0.92,
          warnings: []
        },
        profileFields: { name: profileName, nidNumber: "63849492839", dateOfBirth: "2002-01-07" }
      });
      const result = buildDecision(changed, "document_only");
      expect(result.overallStatus).toBe("VERIFIED");
      expect(result.checks.profileNameMatch.status).toBe("PASS");
      expect(result.checks.profileDateOfBirthMatch.status).toBe("PASS");
    }
  );

  it("tolerates a small OCR name omission while preserving identity checks", () => {
    const changed = observation({
      ocr: {
        status: "COMPLETED",
        fields: { name: "TAF SHEIKH", nidNumber: "63849492839", dateOfBirth: "07 Jan 2002" },
        confidence: 0.87,
        warnings: []
      },
      profileFields: { name: "Tafi Sheikh", nidNumber: "63849492839", dateOfBirth: "2002-01-07" }
    });
    const result = buildDecision(changed, "document_only");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.scores.profileNameSimilarity).toBeGreaterThanOrEqual(0.9);
  });

  it("finds a profile name in OCR text when the printed Name label is missed", () => {
    const changed = observation({
      ocr: {
        status: "COMPLETED",
        rawText: "Government of Bangladesh HABIBUR RAHMAN Date of Birth 01 Dec 1999 NID No 331 408 9875",
        fields: { nidNumber: "3314089875", dateOfBirth: "1999-12-01" },
        confidence: 0.54,
        warnings: ["Full name could not be extracted from the NID front."]
      },
      profileFields: { name: "Habibur Rahman", nidNumber: "3314089875", dateOfBirth: "1999-12-01" }
    });
    const result = buildDecision(changed, "document_only");
    expect(result.overallStatus).toBe("VERIFIED");
    expect(result.checks.profileNameMatch.status).toBe("PASS");
    expect(result.scores.profileNameSimilarity).toBe(1);
    expect(result.warnings).not.toContain("Full name could not be extracted from the NID front.");
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

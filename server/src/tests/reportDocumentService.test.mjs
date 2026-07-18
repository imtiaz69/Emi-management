import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  REPORT_DEFINITIONS,
  createReportDocument,
  getReportSummary
} = require("../services/reportDocumentService");

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

function salesRows(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(2026, 6, index + 1),
    reference: `ORD-${String(index + 1).padStart(5, "0")}`,
    saleType: index % 2 ? "EMI" : "Cash",
    buyer: `Buyer ${index + 1}`,
    product: `Professional report test product ${index + 1}`,
    principal: 10000 + index * 500,
    totalPayable: 11200 + index * 600,
    contractValue: 11200 + index * 600,
    status: index % 2 ? "active" : "paid"
  }));
}

describe("professional report documents", () => {
  it("keeps every report table at the full landscape content width", () => {
    Object.values(REPORT_DEFINITIONS).forEach((definition) => {
      expect(definition.columns.reduce((sum, column) => sum + column.width, 0)).toBe(758);
    });
  });

  it("calculates sales summary values from the same exported rows", () => {
    const summaries = getReportSummary("sales", salesRows());
    expect(summaries[0]).toMatchObject({ label: "Recognized sales", value: 43000, money: true });
    expect(summaries[1].value).toBe(21000);
    expect(summaries[2].value).toBe(22000);
    expect(summaries[3].value).toBe(4);
  });

  it("generates a valid, paginated PDF for a long report", async () => {
    const pdf = await collectPdf(
      createReportDocument({
        type: "sales",
        rows: salesRows(48),
        organization: {
          name: "FinanceLend Demo Store",
          email: "seller@example.com",
          address: "Sylhet, Bangladesh"
        },
        filters: { from: "2026-07-01", to: "2026-07-31" },
        generatedBy: { name: "Seller Test" },
        generatedAt: new Date("2026-07-18T12:00:00.000Z")
      })
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(8000);
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length || 0).toBeGreaterThan(1);
  });
});

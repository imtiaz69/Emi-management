export const KYC_DOCUMENT_TYPES = [
  { value: "nid", label: "NID" },
  { value: "passport", label: "Passport" },
  { value: "tin_certificate", label: "TIN certificate" },
  { value: "job_id_card", label: "Job ID card" },
  { value: "salary_certificate", label: "Salary certificate" },
  { value: "bank_statement", label: "Bank statement" },
  { value: "utility_bill", label: "Utility bill" },
  { value: "other", label: "Other related document" }
];

export function formatKycType(type = "") {
  return KYC_DOCUMENT_TYPES.find((item) => item.value === type)?.label || type.replace(/_/g, " ").toUpperCase();
}

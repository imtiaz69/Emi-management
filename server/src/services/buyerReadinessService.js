const BuyerProfile = require("../models/BuyerProfile");
const KYCDocument = require("../models/KYCDocument");

function getMissingProfileFields(profile) {
  const missing = [];
  if (!profile?.address) missing.push("address");
  if (!profile?.nidNumber) missing.push("NID number");
  if (!profile?.dateOfBirth) missing.push("date of birth");
  if (!profile?.emergencyContactPhone) missing.push("emergency contact phone");
  if (!profile?.monthlyIncome || Number(profile.monthlyIncome) <= 0) missing.push("monthly income");
  if (!profile?.occupation) missing.push("occupation");
  if (!profile?.employmentType) missing.push("employment type");
  return missing;
}

async function getBuyerReadiness(buyerId, { session } = {}) {
  const [profile, latestNidVerification] = await Promise.all([
    BuyerProfile.findOne({ userId: buyerId }).session(session || null),
    KYCDocument.findOne({
      userId: buyerId,
      type: "nid",
      verificationMethod: "identity_cross_validation"
    }).sort({ createdAt: -1 }).select("status").session(session || null)
  ]);
  const missingFields = getMissingProfileFields(profile);
  const hasKyc = latestNidVerification?.status === "approved";
  return {
    profile,
    missingFields,
    hasKyc,
    ready: missingFields.length === 0 && hasKyc
  };
}

async function assertBuyerReadyForEmi(buyerId, { session } = {}) {
  const readiness = await getBuyerReadiness(buyerId, { session });
  if (!readiness.ready) {
    const details = [];
    if (readiness.missingFields.length) details.push(`complete buyer profile: ${readiness.missingFields.join(", ")}`);
    if (!readiness.hasKyc) details.push("verify and obtain approval for your NID");
    const error = new Error(`Before requesting EMI, please ${details.join(" and ")}.`);
    error.status = 400;
    throw error;
  }
  return readiness;
}

module.exports = { assertBuyerReadyForEmi, getBuyerReadiness, getMissingProfileFields };

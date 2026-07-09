const BuyerProfile = require("../models/BuyerProfile");
const KYCDocument = require("../models/KYCDocument");

function getMissingProfileFields(profile) {
  const missing = [];
  if (!profile?.address) missing.push("address");
  if (!profile?.nidNumber) missing.push("NID number");
  if (!profile?.emergencyContactPhone) missing.push("emergency contact phone");
  if (!profile?.monthlyIncome || Number(profile.monthlyIncome) <= 0) missing.push("monthly income");
  if (!profile?.occupation) missing.push("occupation");
  if (!profile?.employmentType) missing.push("employment type");
  return missing;
}

async function getBuyerReadiness(buyerId, { session } = {}) {
  const [profile, kycCount] = await Promise.all([
    BuyerProfile.findOne({ userId: buyerId }).session(session || null),
    KYCDocument.countDocuments({ userId: buyerId, status: { $in: ["pending", "approved"] } }).session(session || null)
  ]);
  const missingFields = getMissingProfileFields(profile);
  return {
    profile,
    missingFields,
    hasKyc: kycCount > 0,
    ready: missingFields.length === 0 && kycCount > 0
  };
}

async function assertBuyerReadyForEmi(buyerId, { session } = {}) {
  const readiness = await getBuyerReadiness(buyerId, { session });
  if (!readiness.ready) {
    const details = [];
    if (readiness.missingFields.length) details.push(`complete buyer profile: ${readiness.missingFields.join(", ")}`);
    if (!readiness.hasKyc) details.push("upload KYC document");
    const error = new Error(`Before requesting EMI, please ${details.join(" and ")}.`);
    error.status = 400;
    throw error;
  }
  return readiness;
}

module.exports = { assertBuyerReadyForEmi, getBuyerReadiness, getMissingProfileFields };

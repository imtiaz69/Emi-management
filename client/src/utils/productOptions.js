export function getProductColors(product) {
  const colors = (product?.colors || []).filter((color) => color?.name);
  return colors.length ? colors : [{ name: "Default", hex: "#64748b" }];
}

export function getProductEmiTerms(product) {
  return {
    interestRate: Number(product?.emiInterestRate || 0),
    interestType: product?.emiInterestType || "flat",
    minDownPayment: Number(product?.emiMinDownPayment || 0),
    maxTenureMonths: Number(product?.emiMaxTenureMonths || 12)
  };
}

export function formatBDT(value) {
  return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
}

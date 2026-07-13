export const CHECKOUT_SELECTION_KEY = "emi_selected_cart_item_ids";

export function readCheckoutSelection() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_SELECTION_KEY);
    if (raw === null) return { exists: false, ids: [] };
    const parsed = JSON.parse(raw);
    return { exists: true, ids: Array.isArray(parsed) ? normalizeIds(parsed) : [] };
  } catch {
    return { exists: false, ids: [] };
  }
}

export function writeCheckoutSelection(ids) {
  sessionStorage.setItem(CHECKOUT_SELECTION_KEY, JSON.stringify(normalizeIds(ids)));
}

export function clearCheckoutSelection() {
  sessionStorage.removeItem(CHECKOUT_SELECTION_KEY);
}

function normalizeIds(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))];
}

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingCart, Store, Trash2 } from "lucide-react";
import { api } from "../api/http";
import { readCheckoutSelection, writeCheckoutSelection } from "../utils/checkoutSelection.js";
import { formatBDT, getProductColors } from "../utils/productOptions.js";
import { notifyError, notifySuccess, notifyWarning } from "../utils/toast.js";

export default function Cart() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ["cart"], queryFn: async () => (await api.get("/cart")).data });
  const [selectedItemIds, setSelectedItemIds] = useState(() => readCheckoutSelection().ids);

  const items = cart.data?.items || [];
  const itemIdsKey = items.map((item) => item._id).join("|");
  const selectedSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedItems = useMemo(() => items.filter((item) => selectedSet.has(item._id)), [items, selectedSet]);
  const groupedStores = useMemo(() => groupItemsByStore(items), [items]);
  const selectedSubtotal = selectedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const cartSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  useEffect(() => {
    const { exists, ids } = readCheckoutSelection();
    const itemIds = items.map((item) => item._id);
    const nextIds = exists ? ids.filter((id) => itemIds.includes(id)) : itemIds;
    setSelectedItemIds(nextIds);
    writeCheckoutSelection(nextIds);
  }, [itemIdsKey]);

  const updateItem = useMutation({
    mutationFn: async ({ itemId, payload }) => api.patch(`/cart/items/${itemId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      notifySuccess("Cart updated.");
    },
    onError: (err) => notifyError(err, "Unable to update cart.")
  });
  const removeItem = useMutation({
    mutationFn: async (itemId) => api.delete(`/cart/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      notifySuccess("Item removed from cart.");
    },
    onError: (err) => notifyError(err, "Unable to remove item.")
  });

  function saveSelection(ids) {
    const normalized = [...new Set(ids.filter(Boolean).map(String))];
    setSelectedItemIds(normalized);
    writeCheckoutSelection(normalized);
  }

  function toggleItem(itemId) {
    if (selectedSet.has(itemId)) {
      saveSelection(selectedItemIds.filter((id) => id !== itemId));
      return;
    }
    saveSelection([...selectedItemIds, itemId]);
  }

  function toggleStore(storeItems) {
    const storeIds = storeItems.map((item) => item._id);
    const storeSelected = storeIds.every((id) => selectedSet.has(id));
    if (storeSelected) {
      saveSelection(selectedItemIds.filter((id) => !storeIds.includes(id)));
      return;
    }
    saveSelection([...selectedItemIds, ...storeIds]);
  }

  function toggleAll() {
    saveSelection(allSelected ? [] : items.map((item) => item._id));
  }

  function changeQuantity(item, nextQuantity) {
    const stock = Number(item.productId?.stock || 1);
    const quantity = Math.min(Math.max(Number(nextQuantity || 1), 1), stock);
    if (quantity !== item.quantity) updateItem.mutate({ itemId: item._id, payload: { quantity } });
  }

  function checkoutSelected() {
    if (!selectedItems.length) {
      notifyWarning("Please select at least one product before checkout.");
      return;
    }
    writeCheckoutSelection(selectedItems.map((item) => item._id));
    navigate("/checkout");
  }

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Shopping Cart</h1>
          <p>Review products store-wise, select the items you want, and choose cash or EMI before checkout.</p>
        </div>
        <Link className="button secondary" to="/marketplace">Continue shopping</Link>
      </div>

      <section className="panel">
        {cart.isLoading ? (
          <div className="empty-state"><ShoppingCart size={34} /><p>Loading cart...</p></div>
        ) : items.length === 0 ? (
          <div className="empty-state"><ShoppingCart size={34} /><p>Your cart is empty.</p></div>
        ) : (
          <>
            <div className="cart-select-bar">
              <label className="inline-check">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                Select all products
              </label>
              <span>{selectedItems.length} of {items.length} selected</span>
            </div>

            <div className="cart-store-list">
              {groupedStores.map((group) => {
                const storeSelected = group.items.every((item) => selectedSet.has(item._id));
                return (
                  <section className="cart-store-group" key={group.sellerId}>
                    <header className="cart-store-header">
                      <label className="inline-check">
                        <input type="checkbox" checked={storeSelected} onChange={() => toggleStore(group.items)} />
                        <Store size={16} /> {group.sellerName}
                      </label>
                      <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                    </header>

                    <div className="cart-item-list">
                      {group.items.map((item) => (
                        <article className="cart-item-row" key={item._id}>
                          <input
                            className="cart-item-check"
                            type="checkbox"
                            checked={selectedSet.has(item._id)}
                            onChange={() => toggleItem(item._id)}
                            aria-label={`Select ${item.productId?.name || "product"}`}
                          />
                          {item.productId?.images?.[0]?.path ? (
                            <img className="cart-item-image" src={item.productId.images[0].path} alt={item.productId?.name} />
                          ) : (
                            <div className="cart-item-placeholder"><ShoppingCart size={24} /></div>
                          )}
                          <div className="cart-item-info">
                            <strong>{item.productId?.name}</strong>
                            <span>{formatBDT(item.unitPrice)} each</span>
                            <span>{item.productId?.stock || 0} in stock</span>
                          </div>
                          <div className="cart-item-mode">
                            <label>Color
                              <select value={item.selectedColorName || getProductColors(item.productId)[0]?.name} onChange={(e) => updateItem.mutate({ itemId: item._id, payload: { selectedColorName: e.target.value } })}>
                                {getProductColors(item.productId).map((color) => <option key={color.name} value={color.name}>{color.name}</option>)}
                              </select>
                            </label>
                            <span className="color-chip">
                              <span className="color-swatch" style={{ backgroundColor: item.selectedColorHex || getProductColors(item.productId).find((color) => color.name === item.selectedColorName)?.hex || "#64748b" }} />
                              {item.selectedColorName || "Default"}
                            </span>
                            <label>Payment option
                              <select value={item.selectedFinanceMode} onChange={(e) => updateItem.mutate({ itemId: item._id, payload: { selectedFinanceMode: e.target.value } })}>
                                <option value="cash">Cash</option>
                                {item.productId?.emiAvailable && <option value="emi">EMI</option>}
                              </select>
                            </label>
                          </div>
                          <div className="quantity-stepper" aria-label="Quantity controls">
                            <button type="button" className="button tiny ghost" disabled={item.quantity <= 1 || updateItem.isPending} onClick={() => changeQuantity(item, item.quantity - 1)}>
                              <Minus size={14} />
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={item.productId?.stock || 1}
                              value={item.quantity}
                              onChange={(e) => changeQuantity(item, e.target.value)}
                              aria-label={`${item.productId?.name || "Product"} quantity`}
                            />
                            <button type="button" className="button tiny ghost" disabled={item.quantity >= Number(item.productId?.stock || 1) || updateItem.isPending} onClick={() => changeQuantity(item, item.quantity + 1)}>
                              <Plus size={14} />
                            </button>
                          </div>
                          <strong className="cart-item-total">{formatBDT(item.quantity * item.unitPrice)}</strong>
                          <button className="button tiny danger" onClick={() => removeItem.mutate(item._id)} disabled={removeItem.isPending}>
                            <Trash2 size={14} /> Remove
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </section>

      {items.length > 0 && (
        <section className="panel checkout-summary">
          <div>
            <span>Selected subtotal</span>
            <strong>{formatBDT(selectedSubtotal)}</strong>
            <span className="hint">Cart total: {formatBDT(cartSubtotal)}</span>
          </div>
          <button className="button" onClick={checkoutSelected} disabled={!selectedItems.length}>Checkout selected</button>
        </section>
      )}
    </section>
  );
}

function groupItemsByStore(items) {
  const map = new Map();
  items.forEach((item) => {
    const sellerId = item.sellerId?._id || item.sellerId || "unknown";
    if (!map.has(String(sellerId))) {
      map.set(String(sellerId), {
        sellerId: String(sellerId),
        sellerName: item.sellerId?.name || "Seller store",
        items: []
      });
    }
    map.get(String(sellerId)).items.push(item);
  });
  return [...map.values()];
}

export function inventoryBalanceAfterDelivery(
  currentBalance: number,
  deliveredQuantity: number,
) {
  const current = Math.trunc(Number(currentBalance) || 0);
  const delivered = Math.max(0, Math.trunc(Number(deliveredQuantity) || 0));
  return current - delivered;
}

export function inventoryBalanceAfterEntry(
  currentBalance: number,
  addedQuantity: number,
) {
  const current = Math.trunc(Number(currentBalance) || 0);
  const added = Math.trunc(Number(addedQuantity) || 0);
  if (added <= 0) throw new Error("La cantidad debe ser mayor a cero.");
  return current + added;
}

export function withInventoryBalance(
  inventory: Record<string, number>,
  key: string,
  balance: number,
) {
  const next = { ...inventory };
  const normalized = Math.trunc(Number(balance) || 0);
  if (normalized === 0) delete next[key];
  else next[key] = normalized;
  return next;
}

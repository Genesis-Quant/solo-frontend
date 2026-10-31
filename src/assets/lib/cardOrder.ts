export function reconciledOrder(order: string[], ids: string[]) {
  const available = new Set(ids);
  const retained = order.filter((id, index) => available.has(id) && order.indexOf(id) === index);
  return [...retained, ...ids.filter((id) => !retained.includes(id))];
}

export function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function restoredCardOrder(stored: unknown, ids: string[], previousDefaultOrder?: string[]) {
  if (!Array.isArray(stored) || !stored.every((item) => typeof item === "string")) return ids;
  // 仅迁移旧默认值；用户自定义顺序不因默认布局调整而丢失。
  if (previousDefaultOrder && sameOrder(stored, previousDefaultOrder)) return ids;
  return reconciledOrder(stored, ids);
}

export const nextStatus = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

export function canMoveStatus(currentStatus, targetStatus) {
  return Boolean(nextStatus[currentStatus]?.includes(targetStatus));
}

export const nextStatus = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

export function canMoveStatus(currentStatus, targetStatus) {
  return Boolean(nextStatus[currentStatus]?.includes(targetStatus));
}

export function canRequestService(customerEmail, technicianEmail) {
  return customerEmail.toLowerCase() !== technicianEmail.toLowerCase();
}

export const FUNCTION_BUDGET_MS = 57_000;
export const GROUP_BUDGET_MS = 25_000;
export const MIN_GROUP_REMAINING_MS = 30_000;

export function canStartGroup(functionDeadline: number, now = Date.now()) {
  return functionDeadline - now >= MIN_GROUP_REMAINING_MS;
}

export function groupDeadline(functionDeadline: number, now = Date.now()) {
  return Math.min(now + GROUP_BUDGET_MS, functionDeadline - 7_000);
}

// At most two Electricity effects at once (lab-ui-foundation R10.3). Pure counter.

export const MAX_ELECTRICITY = 2;

export interface ElectricityBudget {
  /** A grant token, or null when the budget is full (the caller draws a steady glow instead). */
  request(): number | null;
  release(token: number): void;
  active(): number;
}

export function createElectricityBudget(limit = MAX_ELECTRICITY): ElectricityBudget {
  const grants = new Set<number>();
  let next = 0;
  return {
    request() {
      if (grants.size >= limit) return null;
      const token = ++next;
      grants.add(token);
      return token;
    },
    release(token) {
      grants.delete(token);
    },
    active() {
      return grants.size;
    },
  };
}

/** The screen's one budget. */
export const electricityBudget: ElectricityBudget = createElectricityBudget();

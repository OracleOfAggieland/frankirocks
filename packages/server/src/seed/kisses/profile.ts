/**
 * The demo profile (brief 054): who the visitor plays, and the three simulated accounts the bank answers from. The
 * first account, `sim-acct-checking-0001`, is the default: a bank row with no `account` is on it. Every name is
 * invented, and every one passes `safeName` unchanged.
 */
import type { DemoProfile } from "../fixture";

export const PROFILE: DemoProfile = {
  displayName: "Jeffrey Kisses",
  bank: {
    itemId: "sim-item-kisses-0001",
    institutionId: "sim-ins-brassmoor-01",
    institutionName: "Brassmoor Savings and Trust",
    accounts: [
      { accountId: "sim-acct-checking-0001", name: "Everyday Checking", mask: "4417", type: "depository", subtype: "checking" },
      { accountId: "sim-acct-savings-0002", name: "Rainy Day Savings", mask: "0902", type: "depository", subtype: "savings" },
      { accountId: "sim-acct-launch-0003", name: "Launch Operations", mask: "7001", type: "depository", subtype: "checking" },
    ],
  },
  google: { email: "jeffrey@kisses.example" },
};

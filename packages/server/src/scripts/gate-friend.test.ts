/** The Friend Tests (brief 034 part 4): registered with vitest. The scripts are in gate-friend.ts. */
import { scriptSuite } from "../testing/script-runner";
import { FRIEND } from "./gate-friend";

for (const s of FRIEND) scriptSuite(s);

/** Twelve exposures with company or quiet (brief 034 part 3): registered with vitest. The scripts are in gate-exposure.ts. */
import { scriptSuite } from "../testing/script-runner";
import { EXPOSURE } from "./gate-exposure";

for (const s of EXPOSURE) scriptSuite(s);

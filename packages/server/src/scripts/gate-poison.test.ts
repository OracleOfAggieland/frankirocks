/** Ten more poison scripts (brief 034 part 2): registered with vitest. The scripts are in gate-poison.ts. */
import { scriptSuite } from "../testing/script-runner";
import { POISON } from "./gate-poison";

for (const s of POISON) scriptSuite(s);

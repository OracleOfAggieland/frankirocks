/** The forty food moments (brief 034 part 1): registered with vitest. The scripts are in gate-food.ts. */
import { scriptSuite } from "../testing/script-runner";
import { FOOD } from "./gate-food";

for (const s of FOOD) scriptSuite(s);

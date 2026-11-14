/** Brief 049 part C, review fix T12: the link cleaner matches any host-shaped token, not a list of endings. */
import { describe, expect, it } from "vitest";
import { ERRAND_LINK_STAND_IN, cleanErrandText } from "./clean";

describe("cleanErrandText links", () => {
  for (const link of ["secure-pay.shop/verify", "bit.do/abc", "login.icu", "pay.example.museum/x", "xn--80ak6aa92e.com", "раураl.рф/login", "Go to my-bank.support now"]) {
    it(`cleans ${link}`, () => {
      const out = cleanErrandText(link);
      expect(out).toContain(ERRAND_LINK_STAND_IN);
      expect(out).not.toMatch(/\.(shop|do|icu|museum|com|рф|support)\b/u);
    });
  }
  for (const plain of ["Let me look.", "The plumber comes Thursday at 9.30 a.m.", "e.g. Friday, i.e. soon", "Dana Park says the lease is due Friday.", "U.S. office, Nov. 5"]) {
    it(`keeps ${plain}`, () => expect(cleanErrandText(plain)).toBe(plain));
  }
});

// Which browsers count as another app's own browser, where the Google sheet offers the page's link first.
import { describe, expect, it } from "vitest";
import { inAppBrowser } from "./in-app-browser";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36";

describe("inAppBrowser", () => {
  it("names the app for Facebook, Messenger, Instagram and the other common ones", () => {
    expect(inAppBrowser(`${IOS} [FBAN/FBIOS;FBAV/489.0.0.36.106;FBBV/671234567;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS]`)).toBe("Facebook");
    expect(inAppBrowser(`${ANDROID} [FB_IAB/FB4A;FBAV/489.0.0.36.106;]`)).toBe("Facebook");
    expect(inAppBrowser(`${IOS} [FBAN/MessengerForiOS;FBAV/480.0.0.40.109]`)).toBe("Messenger");
    expect(inAppBrowser(`${IOS} Instagram 357.0.0.25.101 (iPhone16,1; iOS 18_1; en_US; en; scale=3.00; 1179x2556; 662323456)`)).toBe("Instagram");
    expect(inAppBrowser(`${IOS} [LinkedInApp]/9.30.1`)).toBe("LinkedIn");
    expect(inAppBrowser(`${ANDROID} musical_ly_2023709030 BytedanceWebview/d8a21c6`)).toBe("TikTok");
    expect(inAppBrowser(`${IOS} Snapchat/13.12.0.42 (like Safari/8618.1.15.10.15, panda)`)).toBe("Snapchat");
    expect(inAppBrowser(`${IOS} Safari Line/14.18.0`)).toBe("LINE");
  });

  it("calls an unnamed Android web view 'this app'", () => {
    expect(inAppBrowser(ANDROID)).toBe("this app");
  });

  it("leaves ordinary browsers and Google's own app alone", () => {
    expect(inAppBrowser(`${IOS.replace(" Mobile/22B83", " Version/18.1 Mobile/15E148 Safari/604.1")}`)).toBeNull();
    expect(inAppBrowser(`${IOS} CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1`)).toBeNull();
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")).toBeNull();
    expect(inAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")).toBeNull();
    expect(inAppBrowser(`${IOS} GSA/343.0.695551749 Mobile/15E148 Safari/604.1`)).toBeNull();
    expect(inAppBrowser(`${ANDROID} GSA/15.44.29.29.arm64`)).toBeNull();
    expect(inAppBrowser("")).toBeNull();
  });
});

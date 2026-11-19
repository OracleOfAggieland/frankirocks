/**
 * Whether the page is open inside another app's own browser, where Google's sign-in often stalls or is refused.
 * Pure: it reads the user-agent string it is given. Returns a name to put in a sentence ("Facebook", "this app"), or
 * null for an ordinary browser. Google's own app is left out: its sign-in works there.
 */
const APPS: readonly (readonly [RegExp, string])[] = [
  [/Instagram/, "Instagram"],
  [/MessengerFor|FB_IAB\/MESSENGER|\bOrca-Android\b/, "Messenger"],
  [/FBAN\/|FBAV\/|FB_IAB|FBIOS|\[FB/, "Facebook"],
  [/LinkedInApp/, "LinkedIn"],
  [/musical_ly|BytedanceWebview|TikTok/, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/\bLine\//, "LINE"],
  [/Pinterest/, "Pinterest"],
];

export function inAppBrowser(ua: string): string | null {
  for (const [pattern, app] of APPS) if (pattern.test(ua)) return app;
  // Android's plain web view marks itself "; wv)". Google's own app is not one to warn about.
  if (/; wv\)/.test(ua) && !/\bGSA\//.test(ua)) return "this app";
  return null;
}

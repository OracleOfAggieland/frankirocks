/**
 * The demo marker (brief 054, R2.6 to R2.8): what the Lab does when it loads at `/lab#demo`. The landing page's
 * Kiroween Demo button is a plain link there, so the press reaches the Lab only as this fragment, which never goes
 * to the server. Pure: the shell in `components/App.tsx` reads the hash, the auth state and the switch's answer, and
 * acts on the one answer here once.
 *
 * Never "signInAnonymously" while anyone is signed in: a real user is offered the switch and keeps their session
 * until they press it; an anonymous user already is the demo, so the marker only goes.
 */
/** The fragment the landing's button links to. `client/demo.ts` re-exports it with the rest of the demo's constants. */
export const DEMO_HASH = "#demo";

/** The auth state as the marker needs it: still loading, nobody, a real (non-anonymous) user, or a demo visit. */
export type MarkerAuth = "loading" | "signedOut" | "signedInReal" | "signedInDemo";

export type MarkerAction = "none" | "clear" | "signInAnonymously" | "offerSwitch";

/** Decides what to do with `/lab#demo`. Never "signInAnonymously" while a non-anonymous user is signed in. */
export function markerAction(x: { hash: string; auth: MarkerAuth; enabled: boolean | null }): MarkerAction {
  if (x.hash !== DEMO_HASH) return "none";
  // Wait for Firebase to say who is here and for the switch's answer.
  if (x.auth === "loading" || x.enabled === null) return "none";
  // The demo is off: the marker goes, and nothing else happens.
  if (!x.enabled) return "clear";
  switch (x.auth) {
    case "signedOut":
      return "signInAnonymously";
    case "signedInDemo":
      return "clear";
    case "signedInReal":
      return "offerSwitch";
    default:
      x.auth satisfies never;
      return "none";
  }
}

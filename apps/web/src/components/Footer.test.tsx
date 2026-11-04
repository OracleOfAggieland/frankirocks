import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/google only works inside the Next compiler; the layout needs only the CSS variable names.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

const { default: RootLayout } = await import("../app/layout");
const { default: Home } = await import("../app/page");
const { AuthPanel } = await import("./AuthPanel");

const noop = () => {};
const layoutProps = (children: React.ReactNode) => ({ children, params: Promise.resolve({}) }) as Parameters<typeof RootLayout>[0];
const footerCount = (html: string) => html.split("Built with Kiro").length - 1;

describe("Built with Kiro footer (R16.7)", () => {
  it("root layout renders 'Built with Kiro' on every page, signed in and signed out", () => {
    const pages: [string, React.ReactNode][] = [
      ["home page", <Home key="home" />],
      ["loading", <AuthPanel key="l" state={{ kind: "loading" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />],
      ["signed out", <AuthPanel key="o" state={{ kind: "signedOut", error: null }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />],
      [
        "signed out after an error",
        <AuthPanel
          key="e"
          state={{ kind: "signedOut", error: { cause: "popupClosed", message: "closed" } }}
          busy={false}
          configMissing={null}
          onSignIn={noop}
          onSignOut={noop}
        />,
      ],
      [
        "signed in",
        <AuthPanel key="i" state={{ kind: "signedIn", email: "owner@example.com", uid: "u1" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />,
      ],
      ["any other page", <p key="x">Not found</p>],
    ];
    for (const [label, page] of pages) {
      const html = renderToStaticMarkup(RootLayout(layoutProps(page)));
      expect(footerCount(html), label).toBe(1);
      expect(html, label).toMatch(/<footer[^>]*>Built with Kiro<\/footer><\/body>/);
    }
  });

  it("signed-in view shows the email; signed-out view shows an enabled sign-in control", () => {
    const signedIn = renderToStaticMarkup(
      <AuthPanel state={{ kind: "signedIn", email: "owner@example.com", uid: "u1" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />,
    );
    expect(signedIn).toContain("owner@example.com");
    expect(signedIn).not.toContain("Sign in with Google");

    const signedOut = renderToStaticMarkup(
      <AuthPanel state={{ kind: "signedOut", error: { cause: "popupBlocked", message: "blocked msg" } }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />,
    );
    expect(signedOut).toMatch(/<button type="button"[^>]*>Sign in with Google<\/button>/);
    expect(signedOut).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(signedOut).toContain('data-cause="popupBlocked"');

    const loading = renderToStaticMarkup(<AuthPanel state={{ kind: "loading" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />);
    expect(loading).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign in with Google/);
  });
});

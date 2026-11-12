import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/google only works inside the Next compiler; the layout needs only the CSS variable names.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
  Fraunces: () => ({ variable: "font-fraunces" }),
}));

const { default: RootLayout } = await import("../app/layout");
const { default: Home } = await import("../app/page");
const { default: LabPage } = await import("../app/lab/page");
const { AuthPanel } = await import("./AuthPanel");
const { default: SpecimensPage } = await import("../app/specimens/page.dev");

const noop = () => {};
const layoutProps = (children: React.ReactNode) => ({ children, params: Promise.resolve({}) }) as Parameters<typeof RootLayout>[0];
const footerCount = (html: string) => html.split("Built with Kiro").length - 1;

describe("Built with Kiro footer (R16.7)", () => {
  it("root layout renders 'Built with Kiro' on every page, signed in and signed out", () => {
    const pages: [string, React.ReactNode][] = [
      ["home page", <Home key="home" />],
      ["lab page", <LabPage key="lab" />],
      ["specimens page", <SpecimensPage key="specimens" />],
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

  it("the layout loads the display font beside the Geist fonts", () => {
    const html = renderToStaticMarkup(RootLayout(layoutProps(<Home />)));
    expect(html).toMatch(/<html[^>]*class="font-geist-sans font-geist-mono font-fraunces /);
  });

  it("the home page is the front door, with one h1 and no server call; the lab page is the app", () => {
    const home = renderToStaticMarkup(<Home />);
    expect(home).toContain("data-landing");
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(home).not.toContain("/api/");
    expect(home).not.toContain("Built with Kiro");
    for (const id of ["top", "loop", "memory", "rules", "build", "wake"]) expect(home, id).toContain(`id="${id}"`);
    const lab = renderToStaticMarkup(<LabPage />);
    expect(lab).toContain("data-screen=");
    expect(lab).not.toContain("data-landing");
  });

  it("signed-in view shows the email; signed-out view shows an enabled sign-in control", () => {
    const signedIn = renderToStaticMarkup(
      <AuthPanel state={{ kind: "signedIn", email: "owner@example.com", uid: "u1" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />,
    );
    expect(signedIn).toContain("owner@example.com");
    expect(signedIn).not.toContain("Sign in to wake Franki");

    const signedOut = renderToStaticMarkup(
      <AuthPanel state={{ kind: "signedOut", error: { cause: "popupBlocked", message: "blocked msg" } }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />,
    );
    expect(signedOut).toMatch(/<button type="button"[^>]*>Sign in to wake Franki<\/button>/);
    expect(signedOut).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(signedOut).toContain('data-cause="popupBlocked"');

    const loading = renderToStaticMarkup(<AuthPanel state={{ kind: "loading" }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} />);
    expect(loading).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign in to wake Franki/);
  });
});

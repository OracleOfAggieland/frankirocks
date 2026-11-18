import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../ui/copy";
import { AccountMenu } from "./AccountMenu";

const html = () => renderToStaticMarkup(<AccountMenu email="owner@example.com" onSignOut={() => {}} onDeleteAccount={async () => true} />);

describe("AccountMenu", () => {
  it("is one closed menu button showing the email in mono 12", () => {
    const h = html();
    expect(h).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(h).toMatch(/data-testid="signed-in-email" class="[^"]*font-mono text-xs/);
    expect(h).toContain("owner@example.com");
    expect(h).not.toContain('role="menu"');
  });

  it("holds a closed confirmation that says what goes and that it can't be undone, Cancel before Delete", () => {
    const h = html();
    const dialog = /<dialog[\s\S]*<\/dialog>/.exec(h)?.[0] ?? "";
    expect(dialog).not.toContain(" open");
    expect(dialog).toContain(COPY.account.title);
    expect(dialog).toContain("can&#x27;t be undone");
    expect(dialog.indexOf('data-action="delete-cancel"')).toBeLessThan(dialog.indexOf('data-action="delete-confirm"'));
    expect(dialog).toContain(`>${COPY.account.confirm}<`);
  });
});

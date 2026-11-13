"use client";
// Where Plaid Link is mounted (brief 046 part B): only while the bank machine holds a Link session, and through a
// lazy import, so `react-plaid-link` and Plaid's script load only after the owner pressed "Connect a bank". A new
// session mounts a new Link (keyed by session).
import { Suspense, lazy } from "react";
import type { BankLinkSession, BankLinkSuccess } from "../../ui/bank/bank-machine";

const BankLink = lazy(() => import("./BankLink"));

export interface BankLinkHostProps {
  link: BankLinkSession | null;
  onOpened: (session: number) => void;
  onSuccess: (session: number, success: BankLinkSuccess) => void;
  onExit: (session: number, error: boolean) => void;
}

export function BankLinkHost({ link, onOpened, onSuccess, onExit }: BankLinkHostProps) {
  if (link === null) return null;
  return (
    <Suspense fallback={null}>
      <BankLink key={link.session} session={link.session} linkToken={link.linkToken} onOpened={onOpened} onSuccess={onSuccess} onExit={onExit} />
    </Suspense>
  );
}

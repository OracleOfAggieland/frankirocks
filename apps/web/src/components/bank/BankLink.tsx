"use client";
// Plaid Link for one session (brief 046 part B). Mounted by `BankLinkHost` only while the bank machine is `linking`,
// and loaded as its own chunk, so neither `react-plaid-link` nor Plaid's script reaches the main screen's first
// load: `usePlaidLink` adds Plaid's script when this mounts, after the owner pressed "Connect a bank". It opens Link
// as soon as Link is ready and reports each answer with its session; Plaid's own window takes the bank sign-in, and
// nothing here holds a bank password, account data or Plaid's error text. Draws nothing.
import { useEffect, useRef } from "react";
import { type PlaidLinkOnExit, type PlaidLinkOnSuccess, usePlaidLink } from "react-plaid-link";
import type { BankLinkSuccess } from "../../ui/bank/bank-machine";

export interface BankLinkProps {
  session: number;
  linkToken: string;
  onOpened: (session: number) => void;
  onSuccess: (session: number, success: BankLinkSuccess) => void;
  onExit: (session: number, error: boolean) => void;
}

export default function BankLink(props: BankLinkProps) {
  const { session, linkToken } = props;
  // Link keeps the callbacks it was created with; these read the latest ones.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const opened = useRef(false);
  const done = useRef(false);

  const onSuccess: PlaidLinkOnSuccess = (publicToken, metadata) => {
    if (done.current) return;
    done.current = true;
    if (publicToken === null || publicToken === "") return latest.current.onExit(session, true);
    const institution = metadata?.institution ?? null;
    latest.current.onSuccess(session, { publicToken, institutionId: institution?.institution_id ?? null, institutionName: institution?.name ?? null });
  };
  const onExit: PlaidLinkOnExit = (error) => {
    if (done.current) return;
    done.current = true;
    latest.current.onExit(session, error !== null);
  };

  const { open, ready, error } = usePlaidLink({ token: linkToken, onSuccess, onExit });

  useEffect(() => {
    // Plaid's script did not load: the try ends calmly, with no detail.
    if (error && !done.current) {
      done.current = true;
      latest.current.onExit(session, true);
    }
  }, [error, session]);

  useEffect(() => {
    if (!ready || opened.current || done.current) return;
    opened.current = true;
    open();
    latest.current.onOpened(session);
  }, [ready, open, session]);

  return null;
}

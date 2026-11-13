"use client";
// The way in to the bank sheet (brief 046 part B): one small brass-edged control in the lab's corner, beside the
// jar. It opens the sheet; the lamp is lit only once the server has answered that a bank is being read.
import type { BankView } from "@franki/core";
import { COPY } from "../../ui/copy";
import { Lamp } from "../lab/Lamp";
import { FOCUS, TARGET } from "../surfaces/classes";

export interface BankWayInProps {
  /** The banks the server last answered, or null before any answer. */
  banks: readonly BankView[] | null;
  open: boolean;
  disabled?: boolean;
  onOpen: () => void;
}

/** True when the server has answered at least one bank that is being read. */
export function bankLit(banks: readonly BankView[] | null): boolean {
  return (banks ?? []).some((b) => (b.state === "connected" || b.state === "syncing") && !b.needsReconnect);
}

export function BankWayIn({ banks, open, disabled = false, onOpen }: BankWayInProps) {
  const lit = bankLit(banks);
  return (
    <button
      type="button"
      data-bank-way-in=""
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      onClick={onOpen}
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center gap-2 rounded-chip border border-brass/70 px-4 text-sm text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi disabled:opacity-40`}
    >
      {lit ? <Lamp on words={COPY.bank.lamp} /> : null}
      {COPY.bank.open}
    </button>
  );
}

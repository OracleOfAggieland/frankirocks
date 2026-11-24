"use client";
// The bank sheet (brief 046 part B). Short: what Franki can and can't do with a bank, that the bank sign-in happens
// in Plaid's own window, one button that opens it, then the connected banks as the server answered them (name,
// accounts by name and last four, importing or when last read, a new sign-in when one is needed) and a disconnect
// that asks Yes or Not now, neither pre-selected. No amounts, no balances, no field of its own. Everything shown is
// in the `BankState` the machine holds; the sheet decides nothing. Brief 054: when the server's answer says the banks
// are simulated (a demo visit), the sheet says so plainly and offers neither Connect nor Disconnect.
// `presentation="sheet"` is modal, as the What I know sheet is: focus moves to the heading on open and back on
// close, stays inside, and Escape closes; a drawer on the right from 1024 px (at most 420 px), a bottom sheet below
// (at most 80svh, scrolling inside). Enter and leave it inside an AnimatePresence so it can rise in and sink out.
import { BANK_LIMIT, type BankView } from "@franki/core";
import { motion, useIsPresent } from "motion/react";
import { type KeyboardEvent, type Ref, useCallback, useEffect, useRef } from "react";
import { type BankState, bankBusy, canStartLink } from "../../ui/bank/bank-machine";
import { bankLine, bankName } from "../../ui/bank/bank-format";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING } from "../../ui/motion";
import { Lamp } from "../lab/Lamp";
import { FOCUS, QUIET_BUTTON, TARGET } from "../surfaces/classes";
import { Seam } from "../surfaces/Seam";
import { FOCUSABLE, nextFocusIndex } from "../surfaces/WhatIKnowSheet";

export type BankPresentation = "inline" | "sheet";

export interface BankActions {
  onClose: () => void;
  onRetry: () => void;
  onConnect: () => void;
  onDisconnect: (connectorId: string) => void;
  onYes: () => void;
  onNotNow: () => void;
}

export interface BankSheetProps extends BankActions {
  state: BankState;
  /** The zone times are shown in. */
  zone: string;
  presentation?: BankPresentation;
}

/** Brass, primary: the one button that opens Plaid's window, and the disconnect's Yes. */
const BRASS_BUTTON = `${TARGET} ${FOCUS} mat-brass inline-flex items-center justify-center rounded-control px-5 text-base font-medium transition-transform duration-(--dur-quick) active:translate-y-0.5 disabled:opacity-40`;
const SMALL_QUIET = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim/70 px-3 text-sm text-ink transition-colors duration-(--dur-quick) hover:bg-night-2 disabled:opacity-40`;

const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** The one line the status region reads: a note after something finished, else what is out right now. */
export function bankStatusLine(s: BankState): string | null {
  if (s.note !== null) return COPY.bank.notes[s.note];
  switch (s.phase) {
    case "reading":
      return COPY.bank.reading;
    case "preparing":
      return COPY.bank.preparing;
    case "linking":
      return COPY.bank.linking;
    case "connecting":
      return COPY.bank.connecting;
    case "disconnecting":
      return COPY.bank.disconnecting;
    case "readFailed":
      return COPY.bank.readFailed;
    case "unread":
    case "idle":
    case "confirming":
      return null;
    default:
      s.phase satisfies never;
      return null;
  }
}

function BankRow({ bank, state, zone, actions }: { bank: BankView; state: BankState; zone: string; actions: BankActions }) {
  const asking = state.confirmId === bank.connectorId && (state.phase === "confirming" || state.phase === "disconnecting");
  const live = bank.state === "connected" || bank.state === "syncing";
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The pressed Disconnect gives way to the question: focus goes to the question, on neither answer.
    if (asking && state.phase === "confirming") question.current?.focus({ preventScroll: true });
  }, [asking, state.phase]);
  return (
    <li data-bank={bank.connectorId} data-bank-state={bank.state} data-importing={bank.importing ? "true" : "false"} className="flex flex-col gap-2 rounded-control border border-ink/10 bg-night-1/80 p-3">
      <div className="flex items-center gap-2">
        <Lamp on={live && !bank.needsReconnect} words={COPY.bank.lamp} />
        <p className="min-w-0 text-base text-ink">{bankName(bank)}</p>
      </div>
      <p data-bank-line="" className={`text-sm ${bank.needsReconnect ? "text-ink" : "text-ink-dim"}`}>
        {bank.needsReconnect ? <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-ember align-middle" /> : null}
        {bankLine(bank, zone)}
      </p>
      {bank.accounts.length > 0 ? (
        <ul aria-label={COPY.bank.accountsLabel} className="flex flex-col gap-0.5 font-mono text-xs text-ink-dim">
          {bank.accounts.map((a, i) => (
            <li key={`${i}-${a.name}-${a.mask ?? ""}`}>{COPY.bank.account(a.name, a.mask)}</li>
          ))}
        </ul>
      ) : null}
      {asking ? (
        <div data-bank-confirm="" className="flex flex-col gap-2">
          <p ref={question} tabIndex={-1} className="text-sm text-ink outline-none">
            {COPY.bank.confirm}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-action="bank-yes" className={BRASS_BUTTON} disabled={state.phase !== "confirming"} onClick={actions.onYes}>
              {COPY.bank.yes}
            </button>
            <button type="button" data-action="bank-not-now" className={QUIET_BUTTON} disabled={state.phase !== "confirming"} onClick={actions.onNotNow}>
              {COPY.bank.notNow}
            </button>
          </div>
        </div>
      ) : state.simulated === true ? null : (
        <div>
          <button type="button" data-action="bank-disconnect" className={SMALL_QUIET} disabled={state.phase !== "idle"} onClick={() => actions.onDisconnect(bank.connectorId)}>
            {COPY.bank.disconnect}
          </button>
        </div>
      )}
    </li>
  );
}

export interface BankSheetViewProps extends BankSheetProps {
  presentation: BankPresentation;
  reduced: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  panelRef?: Ref<HTMLElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/** The sheet's drawing, with no state of its own. */
export function BankSheetView({ state, zone, presentation, reduced, headingRef, panelRef, onKeyDown, ...actions }: BankSheetViewProps) {
  const sheet = presentation === "sheet";
  const line = bankStatusLine(state);
  const banks = state.banks;
  const head = (
    <div className={`flex items-center justify-between gap-3 ${sheet ? "px-5 pt-3" : ""}`}>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg text-ink outline-none">
        {COPY.bank.title}
      </h2>
      <button type="button" data-action="close" className={`${QUIET_BUTTON} text-sm`} onClick={actions.onClose}>
        {COPY.bank.close}
      </button>
    </div>
  );
  const body = (
    <div data-sheet-body="" className={`flex flex-col gap-4 ${sheet ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]" : ""}`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-base text-ink">{COPY.bank.readOnly}</p>
        {state.simulated === true ? (
          <p data-bank-simulated="" className="text-sm text-ink">
            {COPY.bank.simulated}
          </p>
        ) : (
          <p className="text-sm text-ink-dim">{COPY.bank.plaid}</p>
        )}
      </div>
      <p role="status" data-bank-status="" className={line === null ? "sr-only" : "text-sm text-ink"}>
        {line ?? ""}
      </p>
      {state.phase === "readFailed" ? (
        <div>
          <button type="button" data-action="bank-retry" className={QUIET_BUTTON} onClick={actions.onRetry}>
            {COPY.bank.retry}
          </button>
        </div>
      ) : null}
      {banks !== null && banks.length > 0 ? (
        <>
          <Seam />
          <ul data-bank-list="" className="flex flex-col gap-2">
            {banks.map((b) => (
              <BankRow key={b.connectorId} bank={b} state={state} zone={zone} actions={actions} />
            ))}
          </ul>
        </>
      ) : null}
      {banks !== null && banks.length === 0 && !bankBusy(state) ? <p className="text-sm text-ink-dim">{COPY.bank.none}</p> : null}
      {canStartLink(state) ? (
        <div>
          <button type="button" data-action="bank-connect" className={BRASS_BUTTON} onClick={actions.onConnect}>
            {COPY.bank.connect}
          </button>
        </div>
      ) : null}
      {banks !== null && !state.canConnect && state.note !== "limit" && state.simulated !== true ? <p className="text-sm text-ink-dim">{COPY.bank.limit(BANK_LIMIT)}</p> : null}
    </div>
  );
  if (!sheet) {
    return (
      <section role="dialog" aria-label={COPY.bank.title} data-bank-sheet="" data-bank-phase={state.phase} className="mat-glass flex w-[343px] max-w-full flex-col gap-4 rounded-card p-4 text-left sm:w-md">
        {head}
        {body}
      </section>
    );
  }
  return (
    <motion.section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={COPY.bank.title}
      data-bank-sheet=""
      data-bank-phase={state.phase}
      data-presentation="sheet"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mat-glass absolute outline-none inset-x-0 bottom-0 flex max-h-[80svh] flex-col rounded-t-card text-left lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-full lg:max-w-[420px] lg:rounded-none lg:rounded-l-card"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      transition={reduced ? fade : { y: { type: "spring", ...SPRING.settle }, opacity: fade }}
    >
      <div className="px-5 pt-4">
        <Seam />
      </div>
      {head}
      {body}
    </motion.section>
  );
}

/** The modal layer: a scrim and the panel, with focus moved in, held in, and handed back. */
function BankSheetLayer(props: Omit<BankSheetViewProps, "presentation" | "headingRef" | "panelRef" | "onKeyDown">) {
  const { onClose } = props;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const holding = useRef(false);
  const present = useIsPresent();

  const handBack = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    handBack();
    onClose();
  }, [handBack, onClose]);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!present) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    holding.current = true;
    heading.current?.focus({ preventScroll: true });
    const guard = (e: FocusEvent) => {
      const p = panel.current;
      // Plaid's own window is an iframe outside the sheet: focus inside it is never pulled back.
      if (holding.current && p && e.target instanceof Node && !p.contains(e.target) && !(e.target instanceof HTMLIFrameElement)) heading.current?.focus({ preventScroll: true });
    };
    const keys = (e: globalThis.KeyboardEvent) => {
      if (!holding.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      const p = panel.current;
      if (e.key !== "Tab" || !p) return;
      const controls = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const next = nextFocusIndex({ count: controls.length, current: controls.indexOf(document.activeElement as HTMLElement), shift: e.shiftKey });
      e.preventDefault();
      (next < 0 ? heading.current : controls[next])?.focus();
    };
    document.addEventListener("focusin", guard);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("focusin", guard);
      document.removeEventListener("keydown", keys, true);
      handBack();
    };
  }, [present, handBack]);

  return (
    <div data-sheet-layer="" data-bank-layer="" className="fixed inset-0 z-50">
      <motion.div aria-hidden="true" data-sheet-scrim="" className="absolute inset-0 bg-night-0/60" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
      <BankSheetView {...props} onClose={close} presentation="sheet" headingRef={heading} panelRef={panel} />
    </div>
  );
}

export function BankSheet({ presentation = "inline", ...props }: BankSheetProps) {
  const reduced = useReducedMotion();
  return presentation === "sheet" ? <BankSheetLayer {...props} reduced={reduced} /> : <BankSheetView {...props} presentation="inline" reduced={reduced} />;
}

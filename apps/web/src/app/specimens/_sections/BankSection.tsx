"use client";
// The bank sheet (brief 046 part B), in every phase the machine has and the notes worth seeing, drawn inline from
// fixture states. Nothing here calls a route or loads Plaid: the linking tile shows what the sheet says while
// Plaid's window is open, without opening it. Then the way in, unlit and lit.
import { BankSheet } from "../../../components/bank/BankSheet";
import { BankWayIn } from "../../../components/bank/BankWayIn";
import { BANK_READ, BANK_ZONE, bankSpecimens } from "../_fixtures/bank";
import { Section, Tile } from "./Section";

const noop = () => {};
const actions = { onClose: noop, onRetry: noop, onConnect: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };

export function BankSection() {
  return (
    <>
      <Section id="bank" title="Bank">
        {bankSpecimens().map((s) => (
          <Tile key={s.id} label={s.label} data-specimen="bank" data-bank-tile={s.id}>
            <BankSheet state={s.state} zone={BANK_ZONE} {...actions} />
          </Tile>
        ))}
      </Section>
      <Section id="bank-way-in" title="Bank, the way in">
        <Tile label="before any answer" data-specimen="bank-way-in" data-bank-tile="way-in-unlit">
          <BankWayIn banks={null} open={false} onOpen={noop} />
        </Tile>
        <Tile label="a bank being read" data-specimen="bank-way-in" data-bank-tile="way-in-lit">
          <BankWayIn banks={[BANK_READ]} open={false} onOpen={noop} />
        </Tile>
        <Tile label="before the visit is known" data-specimen="bank-way-in" data-bank-tile="way-in-disabled">
          <BankWayIn banks={null} open={false} disabled onOpen={noop} />
        </Tile>
      </Section>
    </>
  );
}

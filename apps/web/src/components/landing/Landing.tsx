"use client";
// The front door at `/` (brief 015). Holds the story step, the state the visitor picked in the toy and
// whether the switch has been thrown, and composes the page in order.
import { useState } from "react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import type { StepId, ToyState } from "../../ui/landing/steps";
import { Build } from "./Build";
import { DemoStage } from "./DemoStage";
import { Hero } from "./Hero";
import { HouseRules } from "./HouseRules";
import { Rail } from "./Rail";
import { Story } from "./Story";
import { Switch } from "./Switch";
import { TopBar } from "./TopBar";

/** Where the lab lives. */
const LAB_HREF = "/lab";

export function Landing() {
  const [step, setStep] = useState<StepId>("hero");
  const [toy, setToy] = useState<ToyState>("listening");
  const [won, setWon] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div data-landing="" className="relative w-full">
      <TopBar />
      <Rail won={won} />
      <main className="mx-auto flex w-full max-w-6xl flex-col px-4">
        <Hero />
        <Story step={step} />
        <DemoStage step={step} toy={toy} onToy={setToy} onYes={() => setStep("yes")} reduced={reduced} />
        <HouseRules />
        <Build />
        <Switch href={LAB_HREF} onThrown={() => setWon(true)} reduced={reduced} />
      </main>
    </div>
  );
}

import { describe, expect, it } from "vitest";
import { radioPhrase } from "./phrase";

describe("radioPhrase", () => {
  it.each([
    ["Frankie, you rock!", "rock"],
    ["you rock franky", "rock"],
    ["Franki rocks", "rock"],
    ["FRANKI YOU ROCK", "rock"],
    ["Frankey... you rock.", "rock"],
    ["Frank, you rock", "rock"],
    ["Hey Franki, honestly, you rock", "rock"],
    ["frankirocks", "rock"],
    // A hit by the rule: a Franki-like name and "rocks" in one utterance.
    ["Frank Sinatra rocks the house", "rock"],
  ])("%s -> %s", (text, want) => {
    expect(radioPhrase(text)).toBe(want);
  });

  it.each([
    ["you rock"],
    ["rock and roll"],
    ["Franki, play some rock"],
    ["Franki, you're a rock star"],
    ["Frankfurt rocks"],
    ["you rock, my friend"],
    [""],
    ["the radio"],
    ["stop"],
    ["turn it off"],
  ])("%s -> null", (text) => {
    expect(radioPhrase(text)).toBeNull();
  });

  it.each([
    ["radio off", "off"],
    ["Radio, off!", "off"],
    ["stop the radio", "off"],
    ["the music, stop it", "off"],
    ["turn off the radio", "off"],
    ["turn the music off", "off"],
    ["Turn the radio off please", "off"],
    ["Could you stop the music?", "off"],
  ])("%s -> %s", (text, want) => {
    expect(radioPhrase(text)).toBe(want);
  });

  it.each([["Don't stop the music"], ["don’t turn off the radio"], ["never stop the music"], ["do not turn the radio off"], ["I love the radio"]])(
    "%s -> null (no off)",
    (text) => {
      expect(radioPhrase(text)).toBeNull();
    },
  );

  it("a line that says both matches neither", () => {
    expect(radioPhrase("Franki you rock, now turn off the radio")).toBeNull();
  });
});

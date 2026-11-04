---
inclusion: always
---

# Product: Franki

Franki is a voice-first life assistant with a memory system, built for Kiroween 2026. The owner talks to Franki out loud; Franki keeps everything with its origin and decides in code what it may say.

Sources: `docs/design/memory-spec-v3.md` (behavior) and `docs/briefs/001-first-spoken-call.md` (current brief).

## The five jobs (`docs/design/memory-spec-v3.md` §1)

1. **Knows what's still true**, and how they know it.
2. **Shows up on the day**, unasked.
3. **Holds back**, and can say why.
4. **Keeps what you've been through together**.
5. **Forgets when told**, and it stays forgotten.

## Current demo goal (`docs/briefs/001-first-spoken-call.md`)

The owner signs in on localhost, presses one button, talks to Franki, says something about their life, hangs up, calls again, and hears Franki use what was said. A plain Debug_Panel shows the stored records (turns, evidence, memories, lineage, jobs, admission entries and the compiled Head) and where each came from.

The spec for this work is `.kiro/specs/first-spoken-call/` (requirements, design, tasks).

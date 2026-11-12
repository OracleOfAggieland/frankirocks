# Review of the wave A build, after the stop at task 22

Stopping was right. The report had the seeds, the shrunk sequences and the cause, and nothing was worked around.

## Property 5

Your analysis holds: `cancelledBefore` counted any earlier teardown as cancelling a response, including one from before the response existed. The reviewer made the correction in commit `d607111`: only a cancel or teardown after the response was created counts. What the property claims is unchanged. It passed 6,000 runs. Record this in task 18's Notes and in the report, with the three seeds.

## Property 8's enumeration

Accepted: 36,288 inputs in the exhaustive half, with the random half drawing every class subset and every boolean. Say so in design §"Correctness Properties".

## One change before the machine work: a late hit cuts only when the reply changes

Rule row 12 has `cut: true`, so any control hit cuts a reply that is already playing under `fastO`. The judge's `H` list has no `rushed` or `why`, so "quick question, what time is it in Denver?" gets `O`, starts its reply, and is then cut and restarted when the parse scores `rushed` at 0.20 or more. The restarted reply is the same kind of reply: same call, same Head, same tools, no note. The cut protects nothing and the owner hears a stutter.

A late hit cuts a playing reply only when its route changes what is said:

| Class | Wave A | Wave B |
|---|---|---|
| `crisis` (retained) | cut; care reply | cut; care reply |
| `forget` | cut; the fixed line | the same |
| `company`, `quiet` | no cut | the swap (cuts) |
| `alone` | no cut | cut; the fixed line |
| `correct`, `transition`, `hardRule`, `food`, `action`, `why`, `answer`, `rushed`, `uncertainSpeaker` hold | no cut | no cut |
| parse failed with a regex match | cut; the Neutral_Line | the same |

- For a no-cut hit, a reply already admitted keeps playing and the server's Permit for that turn is ignored, as for an ordinary parse. A turn that was held plays under the `postCommitControl` Permit as designed. The decision is written either way.
- Choose how the response tells the browser "don't cut" within the closed `TurnResponse` (for example the status), and update the status table, question 60 and the machine rows.
- Update rule row 12, `admission.test.ts`, the design and the requirements. Property 8 doesn't assert `cut` on these rows, so its file needn't change. If any guarded property does need to change, stop and report.
- Add a contract question: each control class decides whether it cuts when its handler is built, and until then only the classes above do. Proposal for v3: say in contracts §6 that "late hit cancels" applies to classes whose route changes the reply.

## Then continue

Apply the change above as one commit before task 23, then run tasks 23 to 44 as before, and stop at the end of wave A.

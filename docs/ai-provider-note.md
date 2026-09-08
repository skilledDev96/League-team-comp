# What the post-game review sends to the model, and what it never does

Written 8 Sep 2026, when the review shipped. The draft advisor (`draftAdvice`,
5 Sep) already sent Riot-derived figures to Anthropic's API; this note puts
the reasoning on record for both.

## What leaves the system, per review

Two requests to Anthropic's Messages API from the `gameReview` Cloud
Function (and from the morning run when `autoReview` is on), each carrying:

- The game as the Games page shows it: queue, date, result, length, side.
- **Our five**: summoner names, seats, champions, the scoreline figures,
  lane reads and habits already on the analysis (`AnalysisPlayer`), and our
  deaths from the derived timeline (minute, zone, how many killers, whether a
  friendly ward was near).
- **The other five as champions in seats only.** No Riot IDs, no names, no
  ranks, no records. They are "Top: Darius".
- The comp's name, its four expectation axes, its game plan text and notes,
  all written by the team.
- The facts of the game (`api/src/game-facts.ts`): the sentences the "How the
  game went" drawer shows, with minutes.
- The team's own match note for that game, trimmed to 1500 characters.

Nothing else. In particular, never:

- A puuid, an email, an access role, a token.
- A raw Riot payload: the match body stays in `matchCache`, the timeline is
  reduced in memory and discarded (`api/src/timeline-features.ts`).
- Anything about an opponent as a person. The system prompt forbids naming,
  rating or criticising anyone on the other team, and the answer validator
  drops any player entry whose name is not one of ours.

## Why this is within Riot's policies

Riot's developer policies restrict what an app **displays and stores** about
players, and forbid apps that dictate decisions, shame players, or expose
live game state. They do not restrict which processor computes a summary of
a team's own match data. The review:

- is post-game only, over finished games;
- reviews our own players, with our own names, about our own play;
- phrases every point as evidence plus a choice or a question, never an
  order (enforced by the prompt and by the caps in the validator);
- stores derived text only (`gameReviews/{matchId}`), which the team can
  delete from the console at any time.

The relevant rows are in the compliance table of
`docs/riot-production-key-application.md`.

## Anthropic's handling of the data

Requests go to the Anthropic API with the team's own key
(`ANTHROPIC_API_KEY`, Google Secret Manager). Anthropic's API data is not
used to train models, and is retained per their published API data policy:
<https://www.anthropic.com/legal/privacy>. Prompt caching keeps the stable
system text on their side for a few minutes between calls.

## Who can trigger it, and what it costs

- Only an admin or contributor can press "Review this game" (the function
  checks the `access` role after verifying the Firebase ID token).
- The morning run reviews at most `MAX_AUTO_REVIEWS` (3) new prep Flex or
  Clash games with a timeline, only when Admin → Settings has "Review new
  prep games each morning" on. Off by default.
- Each review is two calls: Opus for the team and the draft, Sonnet for the
  player notes. `usage` and an estimated `costUsd` (list prices in
  `api/src/game-review.ts`) are stored on every review and summed into
  `meta/refreshLog.reviews`; Diagnostics shows both. Around a dime a game
  at the September 2026 list prices.

## How to turn it off

- Switch off `autoReview` under Admin → Settings: nothing runs by itself.
- Unset the secret (`firebase functions:secrets:destroy ANTHROPIC_API_KEY`)
  and redeploy: the button answers 503 with a plain sentence, the morning
  run logs `skipped: 'noKey'`.

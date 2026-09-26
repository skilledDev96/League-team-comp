# What the AI features send to the model, and what they never do

Two Cloud Functions send data to Anthropic's Messages API: the **post-game
review** (`gameReview`, shipped 8 Sep 2026) and the **draft advisor**
(`draftAdvice`, shipped 5 Sep 2026). Each has its own section below, with its
own list of what leaves the system, when it runs and why it is within Riot's
policies. **What one section says does not cover the other**: they run at
different times, over different data, for different purposes.

The advisor's section was written on 26 Sep 2026. That day a support ticket to
Riot (production key, App 876788) described the advisor as sending the other
team "as champions in seats only, with no Riot IDs, names, ranks or records".
The code did not match: until then it sent each opponent's Riot game name,
rank, per-champion record, the champions that had beaten them, their top
masteries and the team's name. The lead chose to make the code match the
ticket, and the same day the advisor was changed to send what the section
below lists and nothing more.

## The post-game review (`gameReview`)

### What leaves the system, per review

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

### Why the review is within Riot's policies

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

### Who can trigger a review, and what it costs

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

## The draft advisor (`draftAdvice`)

### When it runs

- **On demand, during a draft, before the game starts.** The draft room is
  the app's own board: the team types or clicks each ban and pick into it as
  the draft happens. The app does not read the League client or champion
  select; the board holds only what the team entered.
- An editor presses **Ask what to pick** ("Ask what to ban" on a ban step,
  "Ask again" once it has answered) at a step of that draft. That is one
  question and one call. The panel is hidden once the draft is complete.
- **Auto-ask is a team setting, off by default.** `Settings.autoAdvisor` is
  the "Ask the advisor automatically when a draft step becomes ours" box
  under Admin → Settings, which only an admin can change in the app
  (`saveSettings` refuses anyone without `canManageUsers`, and only an admin
  sees the Settings tab). The Firestore rules hold the same line only from the
  members-only rules written on 26 Sep 2026: before them, the catch-all
  `match /{document=**} { allow write: if canEdit(); }` let any editor write
  `meta/settings` through the SDK, so those rules ship with this change. The
  seed carries no such field, the settings form writes `false`
  unless the box is ticked, and the room asks by itself only when the stored
  value is exactly `true` (`frontend/src/app/pages/tournaments/draft/draft.component.ts`,
  the `autoAsk` effect). Even then it asks at most once per step, only on our
  own turn, only in a tab in edit mode while the draft sequence is running,
  and never when the game already holds an answer for that step.

### What it returns

A one-sentence summary; **up to three** picks (each a champion, a seat, a
one-clause reason and a confidence) or up to three bans (a champion and a
reason); and up to three short things to watch for. `parseAdvice` enforces
the caps and drops any champion that is not on the candidate list the app
sent, so the model cannot name a banned, burned or already-picked champion.

These are options, not moves. Nothing reaches the board by itself: a click on
a suggestion holds the champion exactly as a click on the champion wall does,
and the drafter locks it with a second, separate action (the confirm button,
or a second Enter). Outside a running sequence a click places it in the seat
the drafter is aiming at, which is still the drafter's click. The answer is
stored on the game (`seriesGames/{id}.advice`) so a reload reads it back
instead of asking again.

### What leaves the system, per question

One request to Anthropic's Messages API from the `draftAdvice` Cloud
Function. The draft room builds it, and the function
(`api/src/draft-advice.ts`, `parseDraftAdviceRequest`) validates it and keeps
only the following, field by field:

- `teamName` — our team's name.
- `action`, `turn`, `stepNumber`, `ourSide`, `seat` — which step of the draft
  is being asked about: a ban or a pick, whose turn, which step, our side, and
  the seat our next pick is for when one is chosen.
- `ourPicks`, `theirPicks` — the champion locked in each seat on each side,
  from the board.
- `bans` — champions banned this game, from the board (a ban nobody saw is
  left out).
- `burned` — champions used earlier in the series, which fearless draft makes
  unavailable.
- `ourRoster` — **our** starters: the name on our roster, the seat, and the
  champions they list.
- `theirRoster` — **the other team as seats and champions**: for each of
  their five starters, the seat and up to five champions, most played first
  ("- Top: plays Aatrox, Renekton, Gnar"). The list comes from that player's
  own ranked history in the seat (the scout's pool), so it is about them in
  the sense that it is what they play, but it carries no name, no figure and
  no rank. Nothing else.
- `comps` — our own comps: the name, the five champions each would field on
  this board, its record from our own games, whether it is still playable and
  which of its champions are gone. A comp's name is the team's own free text,
  so it is scrubbed exactly like the notes below ("Anti-Zzq" would otherwise
  name one of theirs).
- `lanes` — the lane read, per lane where something is known: a verdict, a
  score and up to three reasons, built from champion-against-champion matchup
  rates and each champion's solo queue rate (both aggregates over many
  players, collected by our own crawler), how at home **our** players are on
  their picks, and champion traits. How at home their players are is left out
  of the read sent to the model, in the score and the verdict as well as the
  sentences (`advisorLanes`). The request says so with
  `lanesWithoutTheirComfort: true`, and the function drops every lane of a
  request that does not: a tab opened before 26 Sep 2026 sent only the first
  three reasons of each lane, so a comfort sentence of theirs was often cut in
  the browser while its points stayed in the score.
- `candidates` — up to 60 champions the model may name, already legal for the
  step. For a pick: our seat's pool, our comps' champions for the seat and the
  rest of the lane. For a ban: the champions their seats play (the pools above,
  and the champions their starters have played in the last two months, from
  their mastery) and the champions our own comps list as threats — bare
  champion names with no seat, player, figure or reason attached. The
  champions that have beaten one of their players were ban candidates until
  26 Sep 2026; they are read off that player's own losses, so they are no
  longer sent.
- `soloRates` — each candidate's solo queue win rate at large, this patch.
- `matchups` — for our pick when their champion in that seat is known: each
  candidate into it, with the win rate and the games behind it (aggregate).
- `notes` — the team's own notes for the series, up to 1500 characters,
  scrubbed before they are sent (`scrubTeamText` in
  `frontend/src/app/pages/tournaments/advisor-request.ts`, and again in
  `api/src/draft-advice.ts`):
  - every link — anything after `http(s)://` or `www.`, or a bare stat-site
    path such as `op.gg/summoners/…` — becomes `[link]`, up to its first
    space. A roster arrives as an op.gg multi-search link, and inside one a
    Riot ID reads "MOSS+drakexo%23hwei", which no name match would find;
  - the exact stored game name and Riot ID (Name#TAG) of anyone on their
    roster, bench included, becomes that player's seat ("their Jungle"), and
    the team's stored name becomes "the other team". This part is done in
    the browser because only the browser holds the names;
  - a rank written as a tier with a division or LP ("Emerald II", "plat 4",
    "450 LP") becomes `[rank]`.

  **The notes are free text, and that is all that is caught.** A record typed
  in ("7/12 on Aatrox"), a nickname, a misspelling, a name written other than
  as stored (a stored "hideonbush" written "Hide on bush"), a short form of
  the team's name ("MAD" for "MAD Synergy") or a description of a player goes
  to the model as typed. The notes are for the team's plan; scouting of their
  players belongs in the app's own scouting views, which are not sent.

The prompt calls the other side "the other team", and its system prompt
forbids the model to name, rate or describe any individual player of theirs:
they are referred to by seat and champion only. Our own players may be named.

Nothing else. In particular, no field the app fills in carries:

- Anything identifying the other team or a person on it: no Riot ID or game
  name, no team name, no rank, no per-champion record or win rate, no list of
  the champions that have beaten them, no mastery level or points, and no
  lane reason or lane score built from one of their players' own games. The
  one way any of these can reach the model is the team typing it into the
  notes or a comp name in a form the scrub above does not catch.
- A puuid, an email, an access role, a token.
- A raw Riot payload. Nothing is fetched from Riot to answer; every figure is
  one the app already stores.

**The server is the guard, not the browser.** A tab left open across a deploy
still runs the old code and sends the old fields, so the function drops them
whatever arrives: each opponent row keeps only its seat and pool, the team's
name is replaced by "the other team", the lanes are dropped unless the
request says they were read without their players' comfort (and a lane that
still carries one of their comfort sentences is dropped even then), every
link and written rank in the notes and the comp names is replaced, and any
opponent names that do arrive are used once to redact that text and then
discarded. `api/src/draft-advice.spec.ts` feeds it a request carrying all of
them and checks the prompt holds none.

### Why the advisor is within Riot's policies

- It runs before the game, over a draft the team enters into the app by hand.
  It reads nothing from the League client, champion select or a live game.
- It offers up to three options with the evidence for each, and the drafter
  chooses; nothing is placed on the board without a person's action.
- The other team is described as champions in seats only, and the model is
  told not to name, rate or describe any of their players. Each seat's
  champions come from that player's own history, as the champions they play,
  with no name, no rank and no figure. Nothing else the app holds about an
  opponent (Riot ID, rank, per-champion record, counters, mastery, the team's
  name) is in the request; what the team types into its own notes is
  scrubbed as described under `notes`, and otherwise goes as typed.
- It stores the answer only (`seriesGames/{id}.advice`): champions, seats and
  a sentence each, which the team can delete with the game.

### Who can ask, and what it costs

- Only an admin or contributor can ask (the function checks the `access` role
  after verifying the Firebase ID token), and only an editor's tab auto-asks.
- One call to Opus per question, at low effort because a draft step has a
  thirty-second clock. A refused request is re-run on a fallback model inside
  the same call. The response carries the token usage; it is not stored.

## Anthropic's handling of the data

Both functions call the Anthropic API with the team's own key
(`ANTHROPIC_API_KEY`, Google Secret Manager). Anthropic's API data is not
used to train models, and is retained per their published API data policy:
<https://www.anthropic.com/legal/privacy>. Prompt caching keeps the stable
system text on their side for a few minutes between calls.

## How to turn them off

- Switch off `autoReview` and `autoAdvisor` under Admin → Settings: nothing
  runs by itself, and each feature then runs only when an editor presses its
  button.
- Unset the secret (`firebase functions:secrets:destroy ANTHROPIC_API_KEY`)
  and redeploy: both stop. "Review this game" and "Ask what to pick" answer
  503 with a plain sentence, and the morning run logs `skipped: 'noKey'`.

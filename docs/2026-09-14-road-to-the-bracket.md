# Road to the Bracket — review and roadmap (14 Sep 2026)

The published page with before-and-after pictures, the data check and Build/Later/Skip picks: https://claude.ai/code/artifact/91fbc370-8834-4f50-8d0d-cfff903108a4

How it was made: the app captured as a viewer and an admin (60 screens); nine specialist reviewers; every suggestion verified against the code and the recorded decisions; a completeness critic and six gap finders; a roadmap synthesised, critiqued and revised. A separate data audit recomputed 239 displayed figures from a read-only copy of Firestore and a verifier re-derived every mismatch (115 confirmed).

## Headline

Bom Squad Draft Hub already does what no other team tool does: it tracks a fearless series' burn, turns each game into a film the team commits to, and records the custom games Riot's API can't see, with a draft room that never moves and claims that always say how many games they rest on. Right now the tournament leans on data with cracks in it: MAD Synergy's Game 1 holds a scrim's replay, a burned Wukong can come back as legal, three of the four drafts run in the room since 8 Sep hold made-up bans, and Paradox Requiem's two unrecorded games may already have stopped playing after the client updated itself on 12 Sep. So this week starts with backups and an evening of repairs at the machine, then small draft-room fixes rehearsed on the test series before the next match. After that, the biggest opportunity is not more pages but one place per moment of the series week, with less to read on each: two lines on a series card saying what is still possible, one thing to do on Home, and a review that says whether the team kept its word.

## Fix first

- **Today, no code: switch on backups before any repair** (C112). This week's repairs rewrite series, bans and games by hand, and today one wrong click can't be undone: a deleted series takes its games and MVP titles with it. Two gcloud commands turn on point-in-time recovery for the last 7 days and weekly backups kept 14 weeks. Then, in order: put MAD Synergy's Game 1 right, correct Paradox Requiem's date, untick 'Show the test aids' on Admin › Diagnostics in the operator's browser, try recording Paradox Requiem Games 1 and 2, and answer the two questions marked for 16 Sep.
- **Today, no code: put the real Game 1 back into MAD Synergy** (G-custom-game-capture-pipeline-4). Game 1 holds the MOSS 2 scrim (EUW1-7977500462), so the 0–3, the 27 burned champions and the review shown for Game 1 all describe a different game. The real game, EUW1-7975248146.rofl, is on disk and matches the room's pick log 10 of 10. Importing it as things stand adds a Game 4 to a decided Bo3. In order: (1) on Plan in edit mode, press unlink on MAD Synergy Game 1 (not delete replay, which deletes Game 1 with its pick log and the scoreboard MOSS 2's game shares); (2) import EUW1-7975248146.rofl with that row's own Import replay; (3) press Refresh matches from Riot on Games; (4) check the series shows three games and MOSS 2 Game 1 still holds EUW1-7977500462; (5) review the real Game 1 (about 27 cents, as the last one cost).
- **Today, no code: correct Paradox Requiem's date** (G-series-week-and-day-sequence-3). Its head reads 13 Sep 20:00 while all three games, their reviews and the MVP line say 10 Sep, and anything that later counts from a kickoff would start from the wrong day. Setting the Scheduled field in its Scouting & bans to the evening of 10 Sep takes a minute. The 'Played Thu 10 Sep' chip that stops this happening again comes in Series night.
- **Tonight, no code: record Paradox Requiem Games 1 and 2 if they still play** (G-custom-game-capture-pipeline-1). A replay only plays on its own patch, and 18 of our 21 customs have already closed without anyone noticing. These two were saved on build 16.18.815 and the client updated itself to 16.18.817 on 12 Sep, so first open Game 1 from match history: if Watch works, record both tonight; if it doesn't, the window has closed. Patch 26.19 closes them for certain around 23 Sep. The admin list of what can still be recorded follows.
- **Code before the series: stop 'vs test' being the next series, and rehearse on it** (C008). Every viewer sees NEXT SERIES vs test and the room opens on 'Test Pick 1'. Dated series come first, and a Sandbox flag keeps 'vs test' off Home and the room's landing while keeping it as the place to rehearse this week's room changes: one full 20-step draft there before the series, with the draft log read back on Diagnostics. The random test buttons then show only on a sandbox series.
- **Code before the series: mark a missed ban as not seen, and keep the random test buttons off real series** (G-draft-room-operator-and-rehearsal-1). Three of the four drafts run in the room since 8 Sep hold made-up bans: first-row tiles clicked to get past the ban phase, and random ones from the Skip bans test button (Paradox Requiem Game 1 bans Akshan twice). The advisor reads them live. One keyboard rule, learned once: Enter with text holds the top match; Enter with something held locks it, after a short pause; Enter on an empty box with nothing held, on a ban step, holds 'Ban not seen'. Nothing in the draft room moves.
- **Code before the series: say whose pick is being held, in the side's colour** (G-draft-room-operator-and-rehearsal-4). The one draft a teammate ran this week fell apart at steps 7–8 putting our Jinx into their step. The held line reads 'THEIR pick 1 · Jinx → their ADC' in red or blue, checked at its longest label so nothing in the draft room moves.
- **Code before the series: enter a game played outside the room, and warn when an earlier game is empty** (G-draft-room-operator-and-rehearsal-2). On 10 Sep, Games 1 and 2 were back-filled with a test button two minutes before Game 3. An empty earlier game silently leaves the burn, the advisor and the Comps popup wrong. A dialog off the page takes both fives and the result in about 30 seconds.
- **Code before the series: make a burned champion stay burned whatever its spelling** (C002). Replays store Riot ids (MonkeyKing, MissFortune), so in Game 2 or 3 the wall, the Comps popup and Pool left can offer a champion that is already gone.
- **Code before the series: rank the Comps popup by confidence, with games beside each rate** (C014). Mid-draft the popup puts a comp that went 1–0 above one that went 5–1, the small-sample mistake the advisor already avoids. Only the popup changes, so the room doesn't move.
- **Code before the series: audit every fearless series, and ask before an import breaks one** (C001). Burned lists hide duplicates, so nothing on screen shows a champion on both sides, one replay in two series, or a 0–3 in a Bo3. First a Diagnostics list; then both import paths ask before a replay repeats a champion, lands in a decided series, reuses a match id, or differs from the room's pick log. The replay can overrule the log, which holds this week's made-up bans. Needed before any result goes to Discord.
- **Code before the series: show one team commitment after a re-review, not two** (C037). Before you play and The card say one thing while the one-thing chapter marks another, in the reminder players read right before a game. It ships before any re-review is run, including one to refresh a review C035 corrects.
- **Code before the series: stop reviews suggesting champions that were never open** (C035). The Paradox Requiem film suggests Sion for Mordekaiser in a game where Sion was theirs, and players carry these swaps into the next draft. First the film, the review panel and Copy for Discord drop any suggested champion the other side played or the series had already burned, which corrects every stored review without a paid re-review. The review's own check follows in Series night.

## Releases

### 1. Trust the board

*When:* Now to Thu 17 Sep. Plan has no dated next series yet; kickoffs are agreed by Thursday and default to Sunday 20:00, so plan for Sun 20 Sep until Plan says otherwise.

Everything the next series leans on tells the truth, and nothing can be lost doing it. Backups go on before any hand repair; MAD Synergy gets its real Game 1; Paradox Requiem's date is corrected and its replays recorded if the client still plays them. Burned champions stay burned, a missed ban can be 'not seen' instead of made up, the room says whose pick is held, the Comps popup ranks by confidence, reviews stop suggesting champions that were never open, and one commitment shows. Every draft-room change is live by Thu 17 Sep, checked so nothing in the room moves, rehearsed with one full 20-step draft on 'vs test' with the log read back on Diagnostics, and signed off by the lead; otherwise it waits until after the series. On the night: one editor in edit mode, everyone else on Share.

- Turn on Firestore's weekly backups and add a Download team data pill — C112 (impact 3, effort S)
- Catch a replay filed against the wrong draft: MAD Synergy G1 holds the MOSS 2 game — G-custom-game-capture-pipeline-4 (impact 4, effort S)
- Show the admin which customs can still be recorded, and roughly when each stops playing — G-custom-game-capture-pipeline-1 (impact 4, effort M)
- Keep test series out of Home and the draft room: prefer dated series, add a Sandbox flag — C008 (impact 4, effort S)
- Let a ban step be entered as 'not seen', and stop Skip bans from banning a champion twice — G-draft-room-operator-and-rehearsal-1 (impact 4, effort S)
- Name the side and step on the held line, so our pick is not entered into their step — G-draft-room-operator-and-rehearsal-4 (impact 4, effort S)
- Enter a game played without the room from the side question, and warn when an earlier game is empty — G-draft-room-operator-and-rehearsal-2 (impact 4, effort S)
- One champion key for the draft wall, bans and burn (MonkeyKing, MissFortune, Kai'Sa) — C002 (impact 5, effort S)
- Show games next to each comp's rate in the Comps popup, and rank playable comps by confidence — C014 (impact 3, effort S)
- Audit fearless series: repeated champions, a game after the series is decided, a replay used twice, a game dated outside its series — C001 (impact 5, effort M)
- Hide a stale commitment after a re-review instead of showing two different ones — C037 (impact 4, effort S)
- Keep review draft swaps to champions that were actually open in that game of the series — C035 (impact 4, effort S)

### 2. Series night

*When:* The week after the next series. Plan has no date for it yet; if it is Sun 20 Sep, the rule book's default, that is about 21–27 Sep. Nothing on Plan or in the room ships in the 48 hours before a series on Plan.

The captain preps and the operator drafts from reads that know the burn and the stakes. The rules come first, with no code: one home per moment, a first-screen budget, and chores the app works out instead of asking for. Then one Series card change, checked once: a one-line tournament head with our record and what is at stake, a plan line (one comp per game, shared champions flagged) and a burn line (what burned, their thinnest seat). The advisor knows the game and the score, search finds champions by initials, watchers on Share see the bans, reviews check their own swaps, and the lead records every custom the night it is played, using the recorder's new list of what still plays.

- Settle the five series-week collisions in round one before any of them is built — G-series-week-and-day-sequence-1 (impact 3, effort S)
- A first-screen budget and a one-in-one-out rule for round one — G-information-budget-and-first-screens-1 (impact 3, effort S)
- Derive round one's editor chores instead of adding switches and typed fields — G-information-budget-and-first-screens-11 (impact 3, effort M)
- Record the stage rule and each series' round, after the lead confirms the format with the Oryx admins — G-tournament-stakes-and-season-arc-1 (impact 3, effort S)
- One Starter line per series card for all of round one; the rest in a Series plan fold — G-information-budget-and-first-screens-7 (impact 3, effort M)
- Fold the tournament card to one line with link pills, so the opened series sits in the first viewport — C026 (impact 3, effort S)
- Give C026's one-line tournament head its content: result pips, record and the stage rule — G-tournament-stakes-and-season-arc-3 (impact 3, effort S)
- Before 5 Oct: one planned comp per game on a Bo3 series, with shared champions flagged — C019 (impact 4, effort M)
- Show which of our comps share champions, so a Game 1 comp doesn't quietly break Game 2's — C020 (impact 4, effort S)
- Split the Plan's Fearless pool into ours and theirs with our pool picks ringed, and put a side dot on each game — C028 (impact 3, effort S)
- Make the Plan ban board burn-aware and show how many champions each of their seats has left — C022 (impact 4, effort S)
- Put our record and the stage rule in Home's Next series meta line, in place of the tournament name — G-tournament-stakes-and-season-arc-2 (impact 3, effort S)
- Hide the Fearless pool on scrim blocks — C029 (impact 2, effort S)
- Print champion display names everywhere and draw empty seats as placeholders — C010 (impact 3, effort S)
- Send the advisor the game number, best-of and series score — C018 (impact 3, effort S)
- Lock, re-seat and undo from the search box: Enter holds, Enter locks, 1-5 seat, Ctrl+Z undo — G-draft-room-operator-and-rehearsal-3 (impact 3, effort S)
- Give watchers on the Share link a fixed bans-and-burned row from before the first ban — C011 (impact 4, effort S)
- Show watchers the same splash on locked picks editors see; leave the empty-seat watermark to the lead — C013 (impact 2, effort S)
- Show when a series was actually played, and say 'Kickoff passed' instead of a stale time — G-series-week-and-day-sequence-3 (impact 3, effort S)
- Record the evening's customs in one sitting: `npm run record -- --pending` — G-custom-game-capture-pipeline-2 (impact 3, effort M)

### 3. Less to read

*When:* After Series night, from about 28 Sep. It changes Games, Patterns, Home, Roster and Comps, so it can ship in a series week; its two Prep lines follow the 48-hour rule.

Every page players open says less and means more: the Next up card only on the Games tab, the plates figure fixed and one lesson per column on Patterns, records that say what they count, no blurbs that repeat titles, no refresh telemetry for viewers, a face instead of 73 repeats of 'MVP', and Home's welcome line carrying your seat's one thing on days it is due. Home's tiles stay as the lead approved them.

- Show Next up on the Games tab only, and hide it on Reviews when it repeats the open review — C062 (impact 4, effort S)
- Fix the impossible 'plates per player' figure and give each stat one column in Keep doing / Work on — C004 (impact 4, effort S)
- Patterns at Starter: one Work on, one Keep doing, and the basis instead of 'filters you cannot see' — G-information-budget-and-first-screens-5 (impact 4, effort S)
- Stop the Games-row callout max-width shrinking Patterns' Work on, and space the record line — C101 (impact 3, effort S)
- Make every record say what it counts, and put Clash in the same group on both tabs — C066 (impact 3, effort S)
- Delete hero blurbs that repeat the title, and the Scrims lines viewers can't act on — G-information-budget-and-first-screens-2 (impact 2, effort S)
- Riot refresh telemetry to editors; viewers keep only 'updated at' — G-information-budget-and-first-screens-4 (impact 2, effort S)
- Game rows: MVP as a gold-ringed face in C063's track; 'Beats us most' to Full — G-information-budget-and-first-screens-6 (impact 2, effort S)
- Order series games correctly and show the Game list 20 rows at a time — C064 (impact 3, effort S)
- Separate name and role in the Games Players table — C065 (impact 2, effort S)
- Fix the Games form strip that a later .form-pip rule crushed, and give one pip shape everywhere that doesn't rely on colour — C099 (impact 3, effort S)
- Drop 'SOLO WIN RATE' from each Roster and Home lineup card; the legend and the Solo subline already say it — C100 (impact 2, effort S)
- Draw a neutral ring with the W–L record for comps under three games, not a red 0% dot — C085 (impact 3, effort S)
- Make Home's welcome band say the one thing to do before the next game, or what is new since your last visit — C048 (impact 4, effort M)

### 4. After the game

*When:* Once Less to read is in. If Split 2 ends on 5 Oct that is the week after; if it runs to 8 Nov these land between series, and nothing on Plan or in the room ships in the 48 hours before one.

The review, film and commitment loop closes for the whole team. A series reads back as one dialog (before, between, after) and posts its result to Discord; every teammate's vote counts, each account knows its player, the next review says whether the commitment was kept, scrims get booked with a flag when their replays never arrive, and Games opens on the last game.

- One series book dialog that C016, C031 and C034 fill, with one Copy for Discord per phase — G-ask-the-data-and-big-bets-8 (impact 3, effort M)
- Add a series debrief on a finished series: what decided each game and what the burn cost us — C034 (impact 4, effort M)
- Add a between-games brief to the Draft complete bar, with Copy for Discord — C016 (impact 4, effort M)
- Add 'Copy the plan for Discord' to a series' Scouting & bans — C031 (impact 3, effort S)
- After a replay import, go straight to Review it: on a finished series, not between games — C015 (impact 3, effort S)
- Link each played series game on Plan to its Games row and film, and name the series in the film bar — C033 (impact 4, effort S)
- A ?games= address on Games that shows exactly a chosen set of rows, with a chip that says so — G-ask-the-data-and-big-bets-4 (impact 2, effort S)
- Post finished series to the team's Discord through a webhook; reviews only as an opt-in morning digest line — C086 (impact 3, effort M)
- Turn the film's 'last game you said' into a verdict on the committed option, shown on the panel and the card — C036 (impact 4, effort M)
- Count every teammate's film-room vote, and let players mark their own work-on as done — C052 (impact 3, effort M)
- Link each Google account to a roster player instead of asking which seat is yours — C051 (impact 4, effort M)
- Bring the review digest into the Roster sheet, and ask the lead before retiring /player/:id — C079 (impact 4, effort M)
- Count what decided our reviewed games, and what our drafts lacked, on the Reviews tab — C067 (impact 4, effort S)
- Give a film link with no review a way forward — C042 (impact 3, effort S)
- Book the next scrim on its block: a time from the add bar, a This week line, and 'Replays owed' when none arrive — G-series-week-and-day-sequence-6 (impact 3, effort S)
- Open Games on the last game as a poster band, replacing Next up and the Record card — G-information-budget-and-first-screens-8 (impact 4, effort M)

### 5. The next split

*When:* After our last Split 2 series: 5 Oct if the Plan card is right, 8 Nov or later if the rule book is.

Close Split 2 properly and start the next split with the team's knowledge, not a blank form: a recap, the stats overview's first cards (how games turn, how each player dies), seat-normal judgements, a fearless pool plan per seat with rehearsal on a sandbox copy, stepping through our own drafts, customs reviewed the morning after they are recorded, and a capped trial of asking the team's data in plain words.

- 'Duplicate for next split' and a 'How it ended' line on the Admin tournament card — G-tournament-stakes-and-season-arc-6 (impact 2, effort S)
- Build a split recap page for Oryx Split 2 that opens after the last series — C088 (impact 3, effort L)
- Aggregate gold state at 15 against result as the first card of the deferred stats overview, with one Work on sentence meanwhile — C069 (impact 4, effort M)
- Add up each player's death ledger across games: ganked, alone, unwarded, jungler in reach — C071 (impact 4, effort M)
- Replace role-blind 'Weaknesses' pills with seat-normal figures from team games — C080 (impact 4, effort M)
- Give each work-on a start date and one measured figure, before and since — C039 (impact 4, effort M)
- Measure fearless depth per seat from champions each player has actually played for the team — C021 (impact 4, effort M)
- Keep one 'against us' file per opponent across series and groups — C023 (impact 3, effort M)
- After the split: a pool plan on the player sheet, measured from team games and named by our own reviews — G-ask-the-data-and-big-bets-9 (impact 3, effort M)
- 'Rehearse' an unplayed series: a sandbox copy that burns like the real Bo3, then deletes itself — G-draft-room-operator-and-rehearsal-8 (impact 3, effort M)
- Step through our own draft in the film's draft chapter, rebuilt from the room's pick order — G-ask-the-data-and-big-bets-7 (impact 3, effort M)
- Mark a recorded custom whose review predates its recording, and let the morning run take it when autoReview is on — G-custom-game-capture-pipeline-5 (impact 2, effort S)
- Customs coverage line now, a fight summary once five are recorded — C076 (impact 2, effort S)
- Record every model call and show this month's spend on Diagnostics — C110 (impact 2, effort S)
- Add a Ctrl+K jump-to dialog over comps, players, opponents and reviews — C092 (impact 3, effort M)
- Ask, after the split: a question box inside the Ctrl+K dialog, editors only, answered by Claude from the team's own game data — G-ask-the-data-and-big-bets-1 (impact 3, effort L)
- Ask's tools: three pure tools over the pages' own functions, every result carrying its sample, and a check for figures no tool returned — G-ask-the-data-and-big-bets-2 (impact 4, effort M)
- Ask's refusals and a live-series gate built from the draft state, which a stuck test draft cannot latch shut — G-ask-the-data-and-big-bets-3 (impact 3, effort S)

## Open questions for the lead

- Answer by Wed 16 Sep: which format and dates is Split 2 really on? The Plan card says Swiss, 28 Aug – 5 Oct. The linked rule book is the 2025 proposal and says Second Division plays round-robin groups, then a Bo3 double-elimination bracket, with Split 2 running to 8 Nov and a Bo5 relegation for the top two. Ask the Oryx admins in Discord. The answer sets the stakes line (G-tournament-stakes-and-season-arc-1 to -3), whether C021 moves up, and every 'after our last Split 2 series' date here.
- Answer by Wed 16 Sep: keep 'vs test' as a sandbox to rehearse the new draft-room controls on (recommended), or delete it? May the made-up bans on Paradox Requiem Games 1 and 2 and on 5s Game 1 be rewritten as 'not seen'? And after the rehearsal, should a second Enter lock a held pick, or should locking stay a click (C008, G-draft-room-operator-and-rehearsal-1)?
- After the next series: in Oryx practice, who chooses side in Games 2 and 3? The rule book only settles Game 1, so the between-games brief (C016) and the side modal (C017) say nothing about it until you confirm.
- After the next series, when you first watch a scrim draft on Share: may watchers get shorter fixed seat cards so all ten seats fit, and should empty seats carry a faint role watermark in both modes (C011–C013)?
- After the next series: on Home, may the welcome line swap your solo stats (your 13 Sep choice) for your seat's ask on days one is due (C048)? And may the Record tile go, since it repeats the hero's stat tiles, and later the Podium, which repeats the MVP race (G-information-budget-and-first-screens-3)? Before and after screenshots at 1920 come first.
- After the next series: may /player/:id become the Roster sheet, with Home's lineup opening the sheet and Admin › Players shrinking to add and remove (C079, slice 2)? You haven't seen the Profile move into the sheet yet.
- After the next series: which Discord channel should finished series post to, and does the team want that on by default, with a morning line of new reviews off by default (C086)?
- Whenever convenient: does Clash belong with Flex or with Scrims on both Games and Patterns (C066)? And is a remake anything under 300 or under 600 seconds (C003, which also moves MVP eligibility)?

## Not recommended

- **A public link-preview card for film-room links (C089)** — It would show custom-game results to anyone with a URL, and Riot's League policy lists custom-queue history shown publicly without opt-in as unapproved. The deliberate brackets that suppress embeds stay.
- **Showing which named teammates watched each review (C046)** — On a team of friends, a watched list the lead can read feels like surveillance. If it's ever wanted, it should be an unnamed count agreed with the team.
- **'Ask to join' for Google accounts that aren't on the access list (C054, slice 2)** — It opens a Firestore write path to strangers on a private app, for a team whose new members are added by the lead from Discord anyway.
- **An in-app availability poll or a lineup vote (C032 as first proposed)** — Scheduling lives in Discord and the Plan page says so. A poll would compete with the channel the team actually uses. Record only a sub for a series, when one plays.
- **Refusing a replay because it disagrees with the room's pick log (G-custom-game-capture-pipeline-4 as first proposed)** — This week the room's pick logs hold made-up bans and a pick entered into the wrong step, so they are the least reliable record. The import names the mismatch and asks, and the replay can overrule the log (C001).
- **A side-choice record, or a claimed 'loser picks side' rule, this split (the side line of C016, and C017's record)** — The rule book only settles Game 1 (a 1v1). Six tournament games can't show a real side gap. Say nothing about Games 2–3 until the lead confirms how Oryx does it.
- **Opening Ask to viewers, or an Ask without a monthly count (G-ask-the-data-and-big-bets-1)** — The browser runs the tools and sends their results, so a viewer account would turn the Anthropic key into a general relay. Editors only, counted on C110's ledger, with the hard cap in the console.
- **A 'their pick not seen' placeholder seat before 'ban not seen' has proved itself (G-draft-room-operator-and-rehearsal-4, slice 2)** — Unlike a ban, an unseen pick hides a real champion from the fearless burn and the advisor until someone fills it.
- **Launching replays automatically or using undocumented League client endpoints for the recorder (G-custom-game-capture-pipeline-2)** — Riot's General Policies forbid undocumented endpoints, and the key is the app. The lead opens each replay; the script works out which game is playing.
- **Deriving a sandbox or merging opponents by name patterns alone (G-information-budget-and-first-screens-11 for C008 and C023)** — 'vs test' already has a game, so 'no games' can't mark it, and 'MOSS 2' may be a second roster. Use an explicit sandbox flag and a one-press 'Same team as…', never an automatic merge.
- **A 'game of the night' split presented as advice (C074)** — Late-night drops are confounded by tilt, fatigue and autofill, which invites exactly the small-sample verdict the app's house style refuses.

## Keep

- The film room's predict-before-reveal, with a team commitment and per-seat asks: a post-game loop no competitor makes a team go through.
- Fearless burn maths with the Comps popup as a native dialog (Still playable, Broken, Pool left) that never moves the draft room.
- The draft room's frozen layout, proven by measuring its tops before every change, with the draft sequence as data and Undo by pick log.
- Sample honesty as house style: 'over 12 losses and 13 wins', show the games, a claim floor, and a dash, never a zero, for a missing figure.
- Riot-policy discipline in the data model: the other side is a team name and champions in seats, and nothing opponent-facing is framed as a weakness.
- The local replay recorder and importer, the only road to the custom games that decide the league.
- The Next up ladder: one card, at most three lines and two pills, and nothing drawn when nothing is due. It is the model for every nudge.
- Home, Roster and Comps as the expressive poster pages, over one slim hero and toolbar on every working page.
- Reviews stored as structured fields and every draft save logged in words, so team-wide tallies are reads rather than new model calls.
- Starter | Full as act-or-check, and Admin › Diagnostics as the operator's console with cost stated where it is decided.

## Every suggestion

| Id | When | Area | Impact | Effort | Title |
|---|---|---|---|---|---|
| C001 | fix-first | quality | 5 | M | Audit fearless series: repeated champions, a game after the series is decided, a replay used twice, a game dated outside its series |
| C002 | fix-first | quality | 5 | S | One champion key for the draft wall, bans and burn (MonkeyKing, MissFortune, Kai'Sa) |
| C008 | fix-first | quality | 4 | S | Keep test series out of Home and the draft room: prefer dated series, add a Sandbox flag |
| C035 | fix-first | quality | 4 | S | Keep review draft swaps to champions that were actually open in that game of the series |
| C037 | fix-first | quality | 4 | S | Hide a stale commitment after a re-review instead of showing two different ones |
| G-draft-room-operator-and-rehearsal-1 | fix-first | quality | 4 | S | Let a ban step be entered as 'not seen', and stop Skip bans from banning a champion twice |
| G-draft-room-operator-and-rehearsal-2 | fix-first | expand | 4 | S | Enter a game played without the room from the side question, and warn when an earlier game is empty |
| G-draft-room-operator-and-rehearsal-4 | fix-first | ux | 4 | S | Name the side and step on the held line, so our pick is not entered into their step |
| G-custom-game-capture-pipeline-1 | fix-first | new | 4 | M | Show the admin which customs can still be recorded, and roughly when each stops playing |
| G-custom-game-capture-pipeline-4 | fix-first | quality | 4 | S | Catch a replay filed against the wrong draft: MAD Synergy G1 holds the MOSS 2 game |
| C014 | fix-first | ux | 3 | S | Show games next to each comp's rate in the Comps popup, and rank playable comps by confidence |
| C112 | fix-first | quality | 3 | S | Turn on Firestore's weekly backups and add a Download team data pill |
| C004 | next | quality | 4 | S | Fix the impossible 'plates per player' figure and give each stat one column in Keep doing / Work on |
| C011 | next | ux | 4 | S | Give watchers on the Share link a fixed bans-and-burned row from before the first ban |
| C019 | next | new | 4 | M | Before 5 Oct: one planned comp per game on a Bo3 series, with shared champions flagged |
| C020 | next | new | 4 | S | Show which of our comps share champions, so a Game 1 comp doesn't quietly break Game 2's |
| C022 | next | new | 4 | S | Make the Plan ban board burn-aware and show how many champions each of their seats has left |
| C048 | next | expand | 4 | M | Make Home's welcome band say the one thing to do before the next game, or what is new since your last visit |
| C062 | next | ux | 4 | S | Show Next up on the Games tab only, and hide it on Reviews when it repeats the open review |
| G-information-budget-and-first-screens-5 | next | ux | 4 | S | Patterns at Starter: one Work on, one Keep doing, and the basis instead of 'filters you cannot see' |
| C010 | next | quality | 3 | S | Print champion display names everywhere and draw empty seats as placeholders |
| C018 | next | expand | 3 | S | Send the advisor the game number, best-of and series score |
| C026 | next | ux | 3 | S | Fold the tournament card to one line with link pills, so the opened series sits in the first viewport |
| C028 | next | ux | 3 | S | Split the Plan's Fearless pool into ours and theirs with our pool picks ringed, and put a side dot on each game |
| C064 | next | ux | 3 | S | Order series games correctly and show the Game list 20 rows at a time |
| C066 | next | ux | 3 | S | Make every record say what it counts, and put Clash in the same group on both tabs |
| C085 | next | visual | 3 | S | Draw a neutral ring with the W–L record for comps under three games, not a red 0% dot |
| C099 | next | visual | 3 | S | Fix the Games form strip that a later .form-pip rule crushed, and give one pip shape everywhere that doesn't rely on colour |
| C101 | next | visual | 3 | S | Stop the Games-row callout max-width shrinking Patterns' Work on, and space the record line |
| G-tournament-stakes-and-season-arc-1 | next | quality | 3 | S | Record the stage rule and each series' round, after the lead confirms the format with the Oryx admins |
| G-tournament-stakes-and-season-arc-2 | next | new | 3 | S | Put our record and the stage rule in Home's Next series meta line, in place of the tournament name |
| G-tournament-stakes-and-season-arc-3 | next | ux | 3 | S | Give C026's one-line tournament head its content: result pips, record and the stage rule |
| G-draft-room-operator-and-rehearsal-3 | next | ux | 3 | S | Lock, re-seat and undo from the search box: Enter holds, Enter locks, 1-5 seat, Ctrl+Z undo |
| G-series-week-and-day-sequence-1 | next | ux | 3 | S | Settle the five series-week collisions in round one before any of them is built |
| G-series-week-and-day-sequence-3 | next | quality | 3 | S | Show when a series was actually played, and say 'Kickoff passed' instead of a stale time |
| G-custom-game-capture-pipeline-2 | next | big-bet | 3 | M | Record the evening's customs in one sitting: `npm run record -- --pending` |
| G-information-budget-and-first-screens-1 | next | ux | 3 | S | A first-screen budget and a one-in-one-out rule for round one |
| G-information-budget-and-first-screens-7 | next | ux | 3 | M | One Starter line per series card for all of round one; the rest in a Series plan fold |
| G-information-budget-and-first-screens-11 | next | ux | 3 | M | Derive round one's editor chores instead of adding switches and typed fields |
| C013 | next | visual | 2 | S | Show watchers the same splash on locked picks editors see; leave the empty-seat watermark to the lead |
| C029 | next | quality | 2 | S | Hide the Fearless pool on scrim blocks |
| C065 | next | quality | 2 | S | Separate name and role in the Games Players table |
| C100 | next | visual | 2 | S | Drop 'SOLO WIN RATE' from each Roster and Home lineup card; the legend and the Solo subline already say it |
| G-information-budget-and-first-screens-2 | next | visual | 2 | S | Delete hero blurbs that repeat the title, and the Scrims lines viewers can't act on |
| G-information-budget-and-first-screens-4 | next | ux | 2 | S | Riot refresh telemetry to editors; viewers keep only 'updated at' |
| G-information-budget-and-first-screens-6 | next | visual | 2 | S | Game rows: MVP as a gold-ringed face in C063's track; 'Beats us most' to Full |
| C016 | soon | new | 4 | M | Add a between-games brief to the Draft complete bar, with Copy for Discord |
| C033 | soon | ux | 4 | S | Link each played series game on Plan to its Games row and film, and name the series in the film bar |
| C034 | soon | new | 4 | M | Add a series debrief on a finished series: what decided each game and what the burn cost us |
| C036 | soon | expand | 4 | M | Turn the film's 'last game you said' into a verdict on the committed option, shown on the panel and the card |
| C051 | soon | expand | 4 | M | Link each Google account to a roster player instead of asking which seat is yours |
| C067 | soon | expand | 4 | S | Count what decided our reviewed games, and what our drafts lacked, on the Reviews tab |
| C079 | soon | ux | 4 | M | Bring the review digest into the Roster sheet, and ask the lead before retiring /player/:id |
| G-information-budget-and-first-screens-8 | soon | visual | 4 | M | Open Games on the last game as a poster band, replacing Next up and the Record card |
| C015 | soon | ux | 3 | S | After a replay import, go straight to Review it: on a finished series, not between games |
| C031 | soon | new | 3 | S | Add 'Copy the plan for Discord' to a series' Scouting & bans |
| C042 | soon | ux | 3 | S | Give a film link with no review a way forward |
| C052 | soon | quality | 3 | M | Count every teammate's film-room vote, and let players mark their own work-on as done |
| C086 | soon | new | 3 | M | Post finished series to the team's Discord through a webhook; reviews only as an opt-in morning digest line |
| G-series-week-and-day-sequence-6 | soon | new | 3 | S | Book the next scrim on its block: a time from the add bar, a This week line, and 'Replays owed' when none arrive |
| G-ask-the-data-and-big-bets-8 | soon | ux | 3 | M | One series book dialog that C016, C031 and C034 fill, with one Copy for Discord per phase |
| G-ask-the-data-and-big-bets-4 | soon | ux | 2 | S | A ?games= address on Games that shows exactly a chosen set of rows, with a chip that says so |
| C021 | later | new | 4 | M | Measure fearless depth per seat from champions each player has actually played for the team |
| C039 | later | expand | 4 | M | Give each work-on a start date and one measured figure, before and since |
| C069 | later | expand | 4 | M | Aggregate gold state at 15 against result as the first card of the deferred stats overview, with one Work on sentence meanwhile |
| C070 | later | new | 4 | M | Show what the first dragon, grubs and herald are worth to us, and which of theirs went uncontested |
| C071 | later | expand | 4 | M | Add up each player's death ledger across games: ganked, alone, unwarded, jungler in reach |
| C080 | later | quality | 4 | M | Replace role-blind 'Weaknesses' pills with seat-normal figures from team games |
| C084 | later | ux | 4 | M | Comp builder: an 'Ours' filter by seat, and no blank comp saved until touched |
| G-ask-the-data-and-big-bets-2 | later | big-bet | 4 | M | Ask's tools: three pure tools over the pages' own functions, every result carrying its sample, and a check for figures no tool returned |
| C003 | later | quality | 3 | S | Leave remakes out of the Games record, average length and form, using one remake rule |
| C006 | later | quality | 3 | M | Wait for the right data before saying 'nothing here', and surface failed listeners |
| C023 | later | new | 3 | M | Keep one 'against us' file per opponent across series and groups |
| C024 | later | expand | 3 | S | Sum up the other team's games together into one 'how they play' line |
| C027 | later | visual | 3 | S | Give the series head one result block and a muted meta line instead of a row of equal chips |
| C040 | later | expand | 3 | S | Split each coaching theme into the last 5 reviews versus earlier |
| C043 | later | ux | 3 | S | Make the film's exit return to where you came from, and rename the chapter Back to Previous |
| C044 | later | visual | 3 | M | Let the board's moments use the empty width, and put the frames on a time rail |
| C053 | later | ux | 3 | M | One 'Add someone' dialog on Admin that ends in a Discord invite, plus Move to the roster |
| C058 | later | ux | 3 | S | Show game-MVP counts beside each name in the MVP race, and break ties on them |
| C063 | later | visual | 3 | M | Put Game list rows on a fixed column grid |
| C075 | later | new | 3 | M | Vision across games: wards against deaths over the last 15 games |
| C077 | later | expand | 3 | M | Stamp a patch on every game and add a patch divider to form strips |
| C082 | later | ux | 3 | S | Name the basis of every player win rate: Ladder, Played, With the team |
| C083 | later | visual | 3 | S | Move the crown off the champion's face; cap name chips on comp seats |
| C088 | later | new | 3 | L | Build a split recap page for Oryx Split 2 that opens after the last series |
| C091 | later | ux | 3 | M | Keep the open comp, player and series in the address bar so a copied URL shares what is on screen |
| C092 | later | new | 3 | M | Add a Ctrl+K jump-to dialog over comps, players, opponents and reviews |
| C111 | later | new | 3 | M | Keep deleted items for 30 days in a Recently removed list with Restore |
| C113 | later | quality | 3 | M | Tell admins when data is stale or partial, with an avatar dot and the reason, and stop swallowing Riot paging errors |
| G-draft-room-operator-and-rehearsal-8 | later | big-bet | 3 | M | 'Rehearse' an unplayed series: a sandbox copy that burns like the real Bo3, then deletes itself |
| G-ask-the-data-and-big-bets-1 | later | big-bet | 3 | L | Ask, after the split: a question box inside the Ctrl+K dialog, editors only, answered by Claude from the team's own game data |
| G-ask-the-data-and-big-bets-3 | later | big-bet | 3 | S | Ask's refusals and a live-series gate built from the draft state, which a stuck test draft cannot latch shut |
| G-ask-the-data-and-big-bets-7 | later | expand | 3 | M | Step through our own draft in the film's draft chapter, rebuilt from the room's pick order |
| G-ask-the-data-and-big-bets-9 | later | big-bet | 3 | M | After the split: a pool plan on the player sheet, measured from team games and named by our own reviews |
| C009 | later | quality | 2 | S | Fix labels that contradict their page: 'Scrim' on a Bo3 review, 'Imported N scrims', 'Dive plays' on every comp |
| C012 | later | visual | 2 | S | Draw the Draft view's series pills as a bare row like Plan's group row; ask the lead about watcher seat height |
| C017 | later | expand | 2 | S | Name the Game 1 side rule in the side modal and record who won the 1v1 |
| C032 | later | new | 2 | S | Mark a sub in for one series, so Pool left and the Comps popup read the five who actually play |
| C047 | later | new | 2 | S | Let a player flag their seat's review ask as not right |
| C055 | later | ux | 2 | S | Rewrite the welcome tour around a member's three jobs: scout, draft, review |
| C059 | later | expand | 2 | M | Make '2 titles all time' and the race rows open a Crowns dialog |
| C076 | later | new | 2 | S | Customs coverage line now, a fight summary once five are recorded |
| C093 | later | ux | 2 | S | Use one scouting label and rename the Roster 'Scout report' tab to 'How they see us' |
| C095 | later | quality | 2 | S | Set tab titles from what is open: film, comp, player, Games tab |
| C097 | later | ux | 2 | S | Move the theme picker into the user menu and stop the default theme reading 'Bomb Squad' |
| C098 | later | visual | 2 | S | Draw Home's objective bars as ours (accent) against theirs (neutral), with a 50% tick |
| C103 | later | visual | 2 | S | Darken the Light theme's accent, teal and green so they pass as text |
| C105 | later | visual | 2 | S | Set a 0.66rem floor for micro labels and lift the 21 declarations below it |
| C106 | later | quality | 2 | S | Give tooltip text to screen readers, and name the champions in 'Beats us most' |
| C107 | later | quality | 2 | S | Announce which segment is on: aria-pressed on Starter / Full and every segmented filter |
| C108 | later | quality | 2 | S | Keep focused fields and helper text clear of the floating EDIT MODE pill |
| C110 | later | new | 2 | S | Record every model call and show this month's spend on Diagnostics |
| C114 | later | quality | 2 | S | Cache Firestore on disk and close the listeners for retired features |
| G-tournament-stakes-and-season-arc-6 | later | new | 2 | S | 'Duplicate for next split' and a 'How it ended' line on the Admin tournament card |
| G-draft-room-operator-and-rehearsal-6 | later | new | 2 | S | Restore a series game to any board in the draft log, from Admin › Diagnostics |
| G-draft-room-operator-and-rehearsal-7 | later | quality | 2 | M | Refuse a draft step that another editor already entered, and say who entered it |
| G-custom-game-capture-pipeline-5 | later | expand | 2 | S | Mark a recorded custom whose review predates its recording, and let the morning run take it when autoReview is on |
| G-information-budget-and-first-screens-3 | later | visual | 2 | S | Home: drop the Record tile and the Podium, which repeat the hero and the race |
| G-information-budget-and-first-screens-10 | later | visual | 2 | M | Patterns Starter slice 2: the record and the top pair as big figures |
| G-custom-game-capture-pipeline-3 | later | quality | 1 | S | Say 'the Replay API is off' when /replay/* answers 404 but the Live Client answers |
| C060 | someday | visual | 3 | M | Crown a new series MVP with a one-time reveal on Home, still under reduced motion |
| C072 | someday | expand | 3 | M | Show on the comp sheet how the comp actually played against 'What we expect', and flag a flat expectation |
| C073 | someday | new | 3 | S | Lane book on the player sheet: lane results by enemy champion type |
| C074 | someday | new | 3 | S | Game of the night: does our play drop late in a session? |
| C081 | someday | expand | 3 | S | Bench and starter tiles say when each player last played a series |
| C087 | someday | new | 3 | S | Add an 'Add to calendar' pill for series with a time, and later a subscribable feed |
| C025 | someday | ux | 2 | S | Show 'How they would ban us' as one strip under our target bans in Scouting & bans |
| C045 | someday | new | 2 | M | Follow the lead's place in a film during a team review |
| C050 | someday | visual | 2 | S | On series day, grow Home's Next series corner into a countdown (mock for the lead first) |
| C054 | someday | ux | 2 | S | Name the account on 'Not authorized', offer Ask to join, and fix the stale login blurb |
| C056 | someday | ux | 2 | S | Make empty states name the real button, and give editors the action pill itself |
| C057 | someday | visual | 2 | S | Cap empty Rank climb and Comp of the month tiles at ghost height |
| C068 | someday | visual | 2 | S | Give a Games row a short open transition and grow its graphs in, behind the Still gate |
| C090 | someday | visual | 2 | S | Add a 'Copy image' pill to Home's MVP spotlight and series result cards |
| C094 | someday | ux | 2 | S | Let our player names on Games open that player on Roster |
| C102 | someday | visual | 2 | S | Lift the Light theme's veil off the Home hero art and cool the welcome band |
| C104 | someday | quality | 2 | S | Add a Text size setting, since browser zoom does nothing under the fluid root size |
| C109 | someday | visual | 2 | S | Give Admin forms a fixed field width and line the scout rows up with the ban board |
| C116 | someday | new | 2 | S | Make Bom Squad installable as its own desktop window with shortcuts to the draft room, Games and Home |
| G-tournament-stakes-and-season-arc-5 | someday | new | 2 | S | An optional split goal, typed by the lead, shown as one clause on Plan's tournament head and the This season tile |
| C038 | drop | expand | 4 | M | Carry a review's seat ask onto the Practice Board, with a pill back to the film |
| C049 | drop | expand | 4 | M | Put 'since you were last here' in the Home welcome band, and New marks on Games rows |
| C005 | drop | quality | 3 | M | Show a site-wide 'numbers as of' line when the refresh or the key is failing |
| C007 | drop | quality | 3 | S | Say which games Home's advice comes from, and headline W–L on small samples |
| C030 | drop | expand | 3 | M | Give a scrim block its last-played date and a one-line focus the team is practising |
| C046 | drop | expand | 3 | S | Show which teammates reached the card of each review |
| C041 | drop | expand | 2 | S | Bring Before you play back on series day, without spending the ladder |
| C061 | drop | ux | 2 | S | Move the quick actions from Roster's hero to Home, without a draft-room door |
| C089 | drop | new | 2 | M | Give film-room links a small Discord preview through a card endpoint (after the webhook) |

The full problem, proposal and implementation note for each id are in the published page and in the review workspace files (round1-trim.json, round2.json).

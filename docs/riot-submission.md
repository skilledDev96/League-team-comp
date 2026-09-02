# Riot Production Key — submission text

*Everything below the line is safe to send. Nothing outside this file is.*

*That is why this file exists apart from `riot-production-key-application.md`,
which holds our own working notes. Paste from here and there is no judgement
call to get wrong in the moment.*

*Re-measure the figures first — see §6 of the working document. They only grow,
and a stale number is the one avoidable way to look careless.*

---
<!-- ▼▼▼ SUBMITTABLE TEXT STARTS HERE ▼▼▼ -->
---

## What does your product do?

Bom Squad Draft Hub is a drafting and review tool for amateur five-stack teams.
A team enters its roster by Riot ID and the champions it plays; the app pulls
each player's ranked history and the team's own 5-stack games, and uses them in
three places: a live draft room that follows the competitive ban/pick sequence
and tracks fearless-draft champion burn across a series; a post-game review that
explains why games were won or lost from objective and fight data; and aggregate
player stats (no specific players) showing champion win rates by rank for the
current patch.

Before a series, a team can look up the opponents it is about to play by the
Riot IDs the league publishes in its fixtures. That shows each opponent's
current ranked tier, the two positions they play most with the number of games
behind each, and the champions they play — all of it their public ranked record,
the same information the League client shows about anyone in a lobby. No
historic Riot IDs, no MMR estimate, and nothing that is not already visible to
the player themselves.

A team can also import its own practice games from the replay files the client
writes, which is the only record a custom game leaves. Those are parsed in the
browser, visible only to that team, and never published.

It is built for the amateur tier that competes in community leagues, where teams
draft seriously but we could find no tool that tracks fearless series burn.

---

## Who is it for, and how does it help players?

Amateur and semi-competitive League teams. Community leagues increasingly run
fearless draft — champions used in one game of a series cannot be used again —
and no tool we could find tracks that burn across games. Teams currently manage
it on paper or from memory, and lose drafts to bookkeeping errors rather than to
decisions.

The measurable help is in preparation: teams see which of their own compositions
remain reachable as a series progresses, and what their record with each
actually is. The tool presents several viable options with the evidence behind
each; it never issues a single instruction, and every number is shown with the
game count it rests on so a small sample cannot be mistaken for a strong one.

---

## How do you use the API?

Match-V5, Summoner-V4, League-V4, Account-V1, Champion-Mastery-V4 and
LoL-Status-V4, all via documented endpoints. Matches the team itself played are
cached keyed by match id and re-read rather than re-fetched, with a schema
version so a cache entry is only re-requested when the data we read from it has
actually changed.

Collection for the aggregate stats walks the ranked ladder page by page and
tallies champion games and wins per tier per patch, plus the five lane pairings
in each match. Nothing from those matches is kept but the counters: a match id
is recorded so the same game is never tallied twice, and a rolling queue of at
most 4,000 puuids is held to know where to read next. Neither is readable by
anyone but our own backend.

On the personal key it runs at half the rate limit so interactive requests are
never delayed behind it.

---

## Why do you need a production key?

The rate limit is the binding constraint, and the shortfall is specific and
measurable rather than a general wish for more headroom.

Champion win rates are complete: all 173 champions, every tier, within days.
Matchup data is not, and cannot be on this key. A single lane has 4,096 possible
champion pairings. In the same window, patch 16.17's top lane has 4,096 pairings
recorded but only 219 at thirty games or more, and ten at a hundred — and the
head of that distribution is Garen, Nasus and Darius, the champions a
competitive team is least likely to be asked about. The tail is where the value
is, and the tail is a rate-limit problem: it needs roughly two orders of
magnitude more matches, and patches ship every two weeks, so the collection
window is fixed and short.

A production key's 3,000 requests per minute against the personal key's 50 is a
sixtyfold increase, which turns "a handful of common matchups per patch" into
"the matchup table is complete before the patch ends". That is the difference
between the draft room quoting a number and showing a blank.

The crawler described above is running today, within the personal key's approved
use, as the proof of concept.

---

## Evidence the aggregate use case is running

Measured 2 September 2026, after the first days of collection on the personal
key at half its rate limit:

- 53,604 ranked matches tallied across patches 16.16 and 16.17.
- All 173 champions past the 400-game floor the product requires before it will
  quote a win rate at all. Median champion: 2,561 games.
- Ten tier buckets populated, Iron through Challenger, so the rate shown is the
  rate at the rank the team actually plays at.
- 28,180 lane matchups recorded, of which 175 have reached 100 games.

Only counters are stored — champion and pairing totals per patch. No match body,
player history or player identifier is retained from any match tallied.

---

## What we are sending with this

- **Live site:** https://skilleddev96.github.io/League-team-comp/
- **Test account:** read-only viewer credentials, supplied separately, so the
  product can be reviewed without signing in with a Riot account.
- **Walkthrough recording:** roster, player detail, compositions, a live draft
  including the champion suggestions, the fearless burn on the second game of a
  series, and the post-game review.

**A note on the recording:** it is captured from an editor account, so it shows
the editing controls. The test account supplied is a read-only viewer and will
show the same screens without them. We recorded it that way so the full flow —
including entering a draft — is visible end to end.

The site carries the required attribution in its footer on every page: created
under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games,
and Riot Games does not endorse or sponsor this project.

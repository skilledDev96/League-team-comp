# Riot Production API Key — application working document

Everything needed to submit, plus the policy text each part answers to. Sources
were read from Riot's own portal on 31 Aug 2026; quotes are verbatim. Evidence
figures were measured on 2 Sep 2026 and are reproducible — see §6.

- General policies: <https://developer.riotgames.com/policies/general>
- LoL game policy (the authoritative one — `/policies/general` covers none of
  the use-case detail): <https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends>
- Portal / rate limits: <https://developer.riotgames.com/docs/portal>

**Framing decision:** this application is for a **private tool used by one
team**, not a public launch. That is deliberate — see §5. It changes the "why do
you need a production key" answer from *"we want to open it up"* to *"the
personal key's rate limit is the binding constraint on the aggregate data the
tool is built on"*, which is both true today and easier to evidence.

---

## 1. Why we qualify

Riot's own list, under *Examples of Approved Use Cases for Production Keys*:

> **"Aggregate player stats (no specific players)."**
> "Training tools that allow players to view their own match histories and aggregate stats."
> "Game overlays that provide static data that is available prior to the game."

Bom Squad Draft Hub is the second and third; the crawler is the first. All three
are on the approved list, which is the strongest possible position to apply from
— we are not asking them to make an exception, only to recognise a category
they already publish.

**What is *not* allowed, and how we stay clear of it:**

| Policy text | How the product complies |
| --- | --- |
| "Apps that dictate player decisions." | The draft advice panel ranks **multiple** options with the record behind each, never a single instruction. Riot's own wording for the compliant shape: *"Products should not remove game decisions, but may highlight decisions that are important and give multiple choices to help players make good decisions."* |
| "Products should increase, and not decrease the diversity of game decisions" | Suggestions are drawn from the team's own champion pool and comps, which widens what a team considers rather than converging everyone on one meta pick. |
| "Products may not provide any game-session-specific information that would be previously unknown to the player." | Everything shown is pre-game and already visible in the client: the draft on screen, and historical aggregates. Nothing reads live game state. |
| "Products cannot create alternatives for official skill ranking systems" | No MMR or ELO estimate anywhere. |
| "Products cannot de-anonymize players who cannot reasonably be identified from visible information" / "may not expose a player's historic Riot IDs" | Players are only ever identified by the Riot ID a person typed in themselves. No historic IDs are stored or shown. |
| "Products may not publicly display a player's match history from the custom match queue unless the player opts in" | Custom games are invisible to the API (queueId 0 never appears in match ids, and `matches/{id}` 404s). Scrims are imported from the team's **own** `.rofl` replay files, parsed in the browser, and shown only to that team. Nothing custom is publicly displayed. |
| Scraping "sources outside of the provided Riot API Endpoints" | **Every** datum comes from Riot's documented endpoints, plus Oracle's Elixir, a dataset published for public analyst use. When a team pastes an op.gg link, only the Riot ID is parsed out of the URL — op.gg itself is never requested. |

---

## 2. What to send

Riot asks for evidence you will deliver on the use case:

> "New app that is fully functional and testable by Riot."
> "You must also send a link to a working site, mockup, prototype, or rendering
>  where it is easy to understand the user flows of the tool."
> "Riot needs to see the user flow to understand what your intended player
>  experience is."

- [x] **Live URL** — <https://skilleddev96.github.io/League-team-comp/>
- [x] **A viewer-role test account.** One already exists for the `e2e` suite and
      is asserted read-only by `e2e/tests/authenticated.spec.ts` ("the account is
      a viewer, so the tests cannot change anything"). Reuse those credentials so
      a reviewer sees the real product without signing in with their own Riot
      account.
- [x] **The attribution notice**, displayed in the site footer on every page
      (`frontend/src/app/app.html:88`): *"…created under Riot Games' 'Legal
      Jibber Jabber' policy using assets owned by Riot Games. Riot Games does not
      endorse or sponsor this project."*
- [x] **The crawler's output** — see §3, *Evidence*. This is now the strongest
      part of the application: the aggregate use case is not a proposal, it is
      running and measurable.
- [ ] **A short user-flow walkthrough.** The one item still outstanding. Sign in
      → roster with Riot IDs → comps → live draft room → post-game review.
      Screenshots suffice; a 2–3 minute screen recording is better.

---

## 3. Draft answers

Trim to whatever the form allows. Keep the phrase "aggregate player stats (no
specific players)" verbatim somewhere — it is their own category name.

### What does your product do?

> Bom Squad Draft Hub is a drafting and review tool for amateur five-stack
> teams. A team enters its roster by Riot ID and the champions it plays; the app
> pulls each player's ranked history and the team's own 5-stack games, and uses
> them in three places: a live draft room that follows the competitive
> ban/pick sequence and tracks fearless-draft champion burn across a series; a
> post-game review that explains why games were won or lost from objective and
> fight data; and aggregate player stats (no specific players) showing champion
> win rates by rank for the current patch.
>
> It is built for the amateur tier that competes in community leagues, where
> teams draft seriously but no existing tool tracks fearless series burn.

### Who is it for, and how does it help players?

> Amateur and semi-competitive League teams. Community leagues increasingly run
> fearless draft — champions used in one game of a series cannot be used again —
> and no existing tool tracks that burn across games. Teams currently manage it
> on paper or from memory, and lose drafts to bookkeeping errors rather than to
> decisions.
>
> The measurable help is in preparation: teams see which of their own
> compositions remain reachable as a series progresses, and what their record
> with each actually is. The tool presents several viable options with the
> evidence behind each; it never issues a single instruction, and every number
> is shown with the game count it rests on so a small sample cannot be mistaken
> for a strong one.

### How do you use the API?

> Match-V5, Summoner-V4, League-V4, Account-V1 and Champion-Mastery-V4, all via
> documented endpoints. Matches are cached in Firestore keyed by match id and
> re-read rather than re-fetched, with a schema version so a cache entry is only
> re-requested when the data we read from it has actually changed.
>
> Collection for the aggregate stats walks the ranked ladder page by page and
> tallies champion games and wins per tier per patch. It stores counters only —
> no match bodies, no player histories, no puuids beyond a transient work queue.
> On the personal key it runs at half the rate limit so interactive requests are
> never delayed behind it.

### Evidence that the aggregate use case is real and working

Measured 2 Sep 2026, after roughly three days of collection on the personal key
at **half** its rate limit:

> - **53,604 ranked matches** tallied across patches 16.16 and 16.17.
> - **All 173 champions** have passed the 400-game floor the product requires
>   before it will quote a win rate at all. Median champion: 2,561 games.
> - **Ten tier buckets** populated, Iron through Challenger, so the rate shown is
>   the rate at the rank the team actually plays at.
> - **28,180 lane matchups** recorded, of which 175 have reached 100 games.
>
> Only counters are stored. The entire dataset is a few hundred kilobytes; no
> match body, player history or identifier is retained.

### Why do you need a production key?

> The rate limit is the binding constraint, and the shortfall is specific and
> measurable rather than a general wish for more headroom.
>
> Champion win rates are complete: all 173 champions, every tier, in three days.
> **Matchup data is not, and cannot be on this key.** A single lane has 4,096
> possible champion pairings. After the same three days, patch 16.17's top lane
> has 4,096 pairings recorded but only **219 at thirty games or more**, and ten
> at a hundred — and the head of that distribution is Garen, Nasus and Darius,
> the champions a competitive team is least likely to be asked about. The tail is
> where the value is, and the tail is a rate-limit problem: it needs roughly two
> orders of magnitude more matches, and patches ship every two weeks, so the
> collection window is fixed and short.
>
> A production key's 3,000 requests per minute against the personal key's 50 is a
> sixtyfold increase, which turns "a handful of common matchups per patch" into
> "the matchup table is complete before the patch ends". That is the difference
> between the draft room quoting a number and showing a blank.
>
> The crawler described above is running today, within the personal key's
> approved use, as the proof of concept.

---

## 4. Order of operations

The policy sets the sequence, and it is the opposite of launch-then-apply:

> "You may not run your application for public consumption using a personal key,
>  **regardless of how long the approval process for your production key takes**."

1. ~~Finish the crawler PoC and let it gather one patch of data.~~ **Done** — two
   patches, 53,604 matches.
2. Record the user-flow walkthrough (the last open deliverable in §2).
3. Register the product on the Developer Portal — required "regardless of
   whether or not your product uses official documented APIs".
4. Apply, with the live URL, the test account and the walkthrough.
5. **Only after approval**, if ever, open it to other teams.

Also standing: **one product per key** — if the crawler is ever presented as a
separate product from the draft hub, it needs its own registration.

---

## 5. Open questions, and where they stand

- **Public or private?** *Resolved: apply as a private, single-team tool.* The
  policy does not require a product to be public to hold a production key — it
  requires the product to be registered, functional and testable by Riot, all of
  which are true. Applying private also removes the multi-tenancy question below
  from the critical path, and nothing prevents a later application to widen it.
- **Multi-team support.** Deferred with the decision above. The public version
  would need teams separable so one cannot read another's scouting; today
  `firestore.rules` grants public read on team data (`allow read: if true`),
  which is fine for one team's own hub and is **not** fine for a multi-team
  product. Do not open it up without changing this first.
- **Monetisation.** None planned. If that ever changes: a free tier is
  mandatory, content must be "transformative", and no exchanging currency back
  into fiat.
- **The op.gg input.** Parse the Riot ID out of the URL only. Fetching op.gg
  would be scraping a source outside Riot's endpoints, whose stated penalty is
  "indefinite revocation of your access to the Riot Games API".

---

## 6. Reproducing the evidence figures

Read straight from Firestore over REST, so the numbers in §3 can be re-measured
before submitting rather than quoted from this document on trust:

```bash
# champion coverage for a patch
curl -s "https://firestore.googleapis.com/v1/projects/lol-bom-squad/databases/(default)/documents/championStats/16.17_ALL"

# matchup density for one lane
curl -s "https://firestore.googleapis.com/v1/projects/lol-bom-squad/databases/(default)/documents/matchupStats/16.17_TOP"
```

`matches` is the tallied match count; `champions` is a nested map of
`{games, wins}`; `pairs` on a matchup document is keyed by the two champions in
alphabetical order. Re-measure on the day you submit — the figures only grow,
and a stale number is the one thing in this document that could read as careless.

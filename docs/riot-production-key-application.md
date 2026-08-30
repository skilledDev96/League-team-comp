# Riot Production API Key — application working document

Everything needed to submit, plus the policy text each part answers to. Sources
were read from Riot's own portal on 31 Aug 2026; quotes are verbatim.

- General policies: <https://developer.riotgames.com/policies/general>
- LoL game policy (the authoritative one — `/policies/general` covers none of
  the use-case detail): <https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends>
- Portal / rate limits: <https://developer.riotgames.com/docs/portal>

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
| "Products may not publicly display a player's match history from the custom match queue unless the player opts in" | Moot — custom games are invisible to the API (queueId 0 never appears in match ids, and `matches/{id}` 404s). Nothing custom is displayed. |
| Scraping "sources outside of the provided Riot API Endpoints" | **Every** datum comes from Riot's documented endpoints, plus Oracle's Elixir, a dataset published for public analyst use. When a team pastes an op.gg link, only the Riot ID is parsed out of the URL — op.gg itself is never requested. |

---

## 2. What to send

Riot asks for evidence you will deliver on the use case:

> "New app that is fully functional and testable by Riot."
> "You must also send a link to a working site, mockup, prototype, or rendering
>  where it is easy to understand the user flows of the tool."
> "Riot needs to see the user flow to understand what your intended player
>  experience is."

- [ ] **Live URL** of the deployed site (GitHub Pages).
- [ ] **A viewer-role test account**, so a reviewer sees the real thing without
      signing in with their own Riot account. One already exists for the e2e
      suite — reuse that pattern.
- [ ] **A short user-flow walkthrough**: sign in → roster with Riot IDs → comps
      → live draft room → post-game review. Screenshots suffice; a 2–3 minute
      screen recording is better.
- [ ] **The crawler's output**, as proof the aggregate use case is real and
      working: champion win rate by tier for the current patch, with game counts.
- [ ] **The attribution notice** already displayed (Legal Jibber Jabber §6).

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
> never delayed behind it; a production key would let it cover the ladder in
> days rather than months.

### Why do you need a production key?

> Two reasons. The personal key's rate limit of 100 requests per two minutes is
> shared between interactive use and collection, which caps the aggregate stats
> at roughly 900,000 games per patch — enough for champion win rates, not enough
> for the matchup and composition data the draft room is built to use. And the
> policy is explicit that a personal key may not be used to run an application
> for public consumption, which is what opening the tool to other teams requires.
>
> The crawler described above is running today as the proof of concept, in line
> with the personal key's approved use.

---

## 4. Order of operations

The policy sets the sequence, and it is the opposite of launch-then-apply:

> "You may not run your application for public consumption using a personal key,
>  **regardless of how long the approval process for your production key takes**."

1. Finish the crawler PoC and let it gather one patch of data.
2. Register the product on the Developer Portal — required "regardless of
   whether or not your product uses official documented APIs".
3. Apply, with the live URL, the test account and the walkthrough.
4. **Only after approval**, open it to other teams.

Also standing: **one product per key** — if the crawler is ever presented as a
separate product from the draft hub, it needs its own registration.

---

## 5. Open questions to resolve before submitting

- **Monetisation.** None planned. If that ever changes: a free tier is
  mandatory, content must be "transformative", and no exchanging currency back
  into fiat.
- **Multi-team support.** The public version needs teams to be separable, so one
  team cannot read another's scouting. Not yet built.
- **The op.gg input.** Parse the Riot ID out of the URL only. Fetching op.gg
  would be scraping a source outside Riot's endpoints, whose stated penalty is
  "indefinite revocation of your access to the Riot Games API".

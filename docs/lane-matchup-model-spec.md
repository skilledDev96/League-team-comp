# Lane Matchup Model — Spec for Implementation

**Project:** Bom Squad Draft Hub — Comps page
**Purpose:** Give the draft a stage-by-stage read of which lanes hold an edge, and roll that up into a team-level tempo call that informs jungle pathing.

---

## 1. What this is (and isn't)

This is **not** a win-rate predictor. Real win rates already come from Lolalytics. This model's job is to explain *why* a lane is favoured and *when* that advantage exists.

The output is a **damage ceiling**: what happens if both champions land everything. It is a theoretical upper bound on a trade, not a prediction of a real lane. That constraint is deliberate — modelling skill-shot hit rates, wave state, and jungle proximity adds assumptions we can't ground in data, and the combinatorics explode.

Where a matchup depends heavily on landing a skill shot, flag it separately rather than trying to discount the damage number.

---

## 2. Data sources

All static per patch:

| Source | Used for |
|---|---|
| DDragon | Ability descriptions, cooldown arrays per rank, base stats, stat growth per level |
| CommunityDragon | Structured ability data, ratios, damage values where DDragon is prose-only |
| Meraki | Cleanest structured stat/ratio data — prefer as primary where available |

Riot Match-V5 and Mastery-V4 are **not** used by this model. They feed the existing champion-pool and role-alternatives features.

---

## 3. Checkpoint levels

Compute the model at four checkpoints only:

- **Level 1** — first trade, pre-jungle
- **Level 3** — all basic abilities available at rank 1
- **Level 6** — ultimates online
- **Level 9** — first max complete

Between-checkpoint levels are interpolated for display only, never computed.

### Assumed state at each checkpoint

| Checkpoint | Gold assumption | Items |
|---|---|---|
| L1 | Starting gold | Starting item only |
| L3 | ~750g | Starting item + components |
| L6 | ~2200g | First mythic/legendary complete |
| L9 | ~4500g | First item + boots + components |

These gold figures are starting estimates and should be tuned against average match data per role. Store them as config, not constants in code.

---

## 4. The trade model

For a given pair of champions at a given checkpoint:

1. Resolve each champion's stats at that level (base + growth × level) plus item stats.
2. Determine which abilities are available and at what rank, using a standard skill-order assumption per champion (max order from Lolalytics or a hardcoded default).
3. Simulate a **fixed trade window of 5 seconds**:
   - Every available ability is cast on cooldown, in a sensible sequence.
   - Auto attacks are woven between abilities at the champion's attack speed.
   - All abilities land. All autos land.
   - No movement, no dodging, no summoner spells, no jungle intervention.
4. Apply damage through the opponent's armour/MR at that checkpoint.
5. Output remaining HP as a percentage for each champion.

**Result:** `hpDelta = winnerRemainingHP% − loserRemainingHP%`

### Edge cases to handle explicitly

- **Sustain** — champions with in-kit healing or lifesteal should have it applied inside the window.
- **Shields** — count as effective HP, not healing.
- **Ranged vs melee** — a melee champion cannot auto a ranged one for free. Apply a range modifier: if range difference exceeds ~150 units, reduce the shorter-range champion's auto count in the window. Start with a 50% reduction and tune.
- **Channelled or conditional ultimates** — if an ultimate's value isn't damage (e.g. invisibility, mobility), it cannot be captured by this model. Tag these champions and surface a note rather than a misleading number.

---

## 5. Bucket thresholds

`hpDelta` maps to three buckets. This is the only thing shown on the board.

| hpDelta | Bucket |
|---|---|
| ≥ 20% | **Strong edge** |
| 8–20% | **Slight edge** |
| < 8% | **Even** |

These thresholds are starting values and belong in config so they can be tuned once there's real output to look at.

The raw `hpDelta` percentage is kept and shown on hover or in a detail row — the depth is available without cluttering the draft view.

---

## 6. Team-level read

On draft complete, roll the per-lane buckets into a single tempo call.

**Windows:** `early` (L1–L3), `mid` (L6), `late` (L9+)

**Count** strong edges per window across the three lanes.

### Rules, evaluated in order

**Rule 1 — Early tempo**
If ≥ 2 strong edges in `early`:
→ Play for early tempo. Jungle paths to the lane with the highest `hpDelta`. Play for first blood and first tower.

**Rule 2 — Scale**
If 0 strong edges in `early` AND ≥ 2 strong edges in `late`:
→ Play safe. Trade objectives, avoid skirmishes before 6, farm to the power spike.

**Rule 3 — Single win condition**
If exactly 1 strong edge in `early` and the rest even or behind:
→ That lane is the win condition. Jungle camps it; other lanes play for neutral and give up nothing.

**Fallback**
If none match, return "balanced draft — no forced tempo" rather than inventing a call.

### Jungle modifier

The jungle matchup is computed the same way but applied as a modifier, not a fourth lane:

- Jungler holds a **strong edge** at `early` → Rule 1 threshold drops to 1 strong lane edge.
- Jungler is **behind** at `early` → Rule 1 requires all 3 lanes to show an edge.

---

## 7. Pipeline

Ability and stat data is static within a patch, so **nothing is computed at draft time.**

**Scheduled Cloud Function**, triggered on patch change (or daily with a patch-version check):

1. Pull champion data from Meraki / CommunityDragon / DDragon.
2. Compute the full champion × champion × checkpoint matrix, **per role** — only same-role pairs are computed, which keeps the matrix tractable.
3. Write versioned to Firestore, keyed by patch.
4. Keep the previous patch's document so a failed build never leaves the app without data.

### Firestore shape

```
matchups/{patch}/{role}/{championA}_{championB}
  {
    a: "Caitlyn",
    b: "Vayne",
    role: "bot",
    checkpoints: {
      "1":  { hpDelta: 30, favoured: "a", bucket: "strong" },
      "3":  { hpDelta: 22, favoured: "a", bucket: "strong" },
      "6":  { hpDelta: 12, favoured: "a", bucket: "slight" },
      "9":  { hpDelta: 5,  favoured: "a", bucket: "even"   }
    },
    flags: ["skillshot-dependent", "b-ult-not-modelled"],
    computedAt: <timestamp>,
    dataVersion: "15.18.1"
  }
```

Store each pair **once** with a canonical ordering (alphabetical) and resolve direction via the `favoured` field, rather than writing both directions.

Draft time is a single document read per lane. No computation client-side.

---

## 8. UI output

On the Comps page, per lane:

> **Bot** — Strong edge early · Even after 6

On draft complete, one team-level line:

> **Early tempo** — two lanes hold a strong edge before 6. Jungle should path bottom.

Flags surface as a small indicator with the reason on hover, e.g. *"Assumes Q lands — skill-shot dependent."*

---

## 9. Known limitations — state these in the UI

- Assumes all abilities and autos land; it is a ceiling, not an expectation.
- Ignores wave state, jungle proximity, summoner spells, and player skill.
- Does not model 2v2 bot lane interaction — bot is computed ADC vs ADC only. Support interaction is a later phase.
- Utility-based ultimates are not captured; affected champions are flagged.
- Thresholds and gold assumptions are unvalidated starting values.

---

## 10. Build order

1. Damage calculation for a single pair at a single checkpoint — validate by hand against a known matchup.
2. Expand to all four checkpoints, add the range and sustain modifiers.
3. Scheduled function generating the full matrix, written to Firestore.
4. Per-lane bucket display on the Comps page.
5. Team-level read and jungle modifier.
6. Tune thresholds against real drafts.

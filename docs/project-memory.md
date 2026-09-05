# League App project memory (claude.ai)

*The project's Memory text as of 5 Sep 2026, committed so it survives outside
the chat. Read it with two later decisions in mind: the compliance line in
`HANDOVER.md` supersedes the data list below — no Lolalytics wrappers, no
DraftGap datasets, nothing outside Riot's endpoints plus Oracle's Elixir — and
the "Comps page revamp" it describes shipped as the comp board and comp
identity (see `HANDOVER.md` §4), with the live draft room taking the
suggestion work from there.*

## Purpose & context

RuanDev is building a League of Legends team planning web app called Bom Squad Draft Hub, designed for team composition planning and draft strategy. The stack is Angular (frontend on GitHub Pages) + Firebase Cloud Functions (backend), with Riot Games API integration already in place (Match-V5, Champion Mastery, DDragon).

The current focus is revamping the Comps page to be more intuitive and click-efficient, inspired by drafter.lol's interface. Core goals:

- Live but non-intrusive comp suggestions that don't override manual entries
- Synergy/counter descriptions explaining comp strengths and weaknesses
- Role alternatives based on team champion pools and mastery data
- Matchup simulator against custom enemy comps (axes: early game, scaling, objectives, teamfight)

Intelligence layer should be data-driven. RuanDev confirmed preference for competitor research input and requested a design/product spec as the immediate deliverable before implementation.

## Current state

A full design/product spec has been produced covering:

- Competitor analysis: drafter.lol, DraftGap, Mobalytics, ProComps, DraftForge, LoLDraftAI, iTero — interaction patterns and standout features documented
- Data stack: DDragon, CommunityDragon, Meraki, Riot Match-V5/Mastery-V4, Lolalytics community wrappers, Oracle's Elixir — with access models and ToS caveats noted
- Comp theory: mapped to matchup simulator evaluation axes
- UX guidance: non-intrusive suggestion pattern recommendations

Recommended build phasing:

1. Interaction board
2. Passive identity layer
3. Subtle suggestion chips
4. Matchup simulator + role-alternatives engine

Meta-data acquisition: scheduled Firebase Cloud Functions with versioned Firestore storage.

## On the horizon

- Moving from spec into implementation phases
- Decisions around data sourcing (community wrappers vs. first-party, ToS compliance)
- Text-to-speech tooling was briefly explored (NaturalReader, Speechify, Balabolka, Panopreter, TTSReader; built-in OS options like Edge Read Aloud also noted) — OS, primary use case, and summarization needs were open questions at conversation close

## Tools & resources

- Frontend: Angular, GitHub Pages
- Backend: Firebase Cloud Functions, Firestore
- APIs: Riot Games (Match-V5, Champion Mastery), DDragon, CommunityDragon, Meraki, Lolalytics community wrappers, Oracle's Elixir
- Reference tools: drafter.lol (primary UX inspiration)

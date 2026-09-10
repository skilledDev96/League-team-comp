import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisGame, MatchTimeline, ReplayRecording } from '../models/team.models';
import { MatchTimelineService } from '../services/match-timeline.service';
import { ReplayRecordingService } from '../services/replay-recording.service';
import { GameStoryComponent } from './game-story.component';

/**
 * "How the game went" reads two documents and picks one. A Riot game has a
 * derived timeline; a tournament or scrim game cannot have one, because Riot
 * cannot see a custom game, and shows the local recorder's lines instead.
 * Neither is read until the drawer is opened.
 */

const RIOT = 'EUW1_7000000001';
const REPLAY = 'EUW1-7977592156';

const timeline = {
  matchId: RIOT,
  timelineVersion: 3,
  builtAt: '2026-09-10T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 1800,
  frameSec: 60,
  goldDiff: [0, 100, -400, -1200],
  curve: { leadAt: {}, biggestLead: { gold: 100, minute: 1 }, biggestDeficit: { gold: -1200, minute: 3 } },
  lanes: [],
  firsts: {},
  objectives: [],
  plates: {},
  deaths: [],
  theirDeaths: [],
  vision: [],
  spend: [],
  facts: { tier: 'timeline', lines: ['Lost after leading at ten.', 'Mid lost the lane by 800 gold at ten.'] },
  bytes: 9000
} as unknown as MatchTimeline;

const recording = {
  matchId: REPLAY,
  recordedAt: '2026-09-10T18:20:00.000Z',
  recorderVersion: 1,
  durationSec: 1860,
  ourSide: 'red',
  seats: [],
  samples: [],
  events: [
    { sec: 1200, kind: 'objective', side: 'them', text: 'Baron', subType: 'Baron' },
    { sec: 1105, kind: 'kill', side: 'them', text: 'Ruan (Top) died to a gank', victimSeat: 'Top' },
    { sec: 1860, kind: 'end', side: 'us', text: 'We won in 31 minutes' }
  ],
  shots: [],
  bytes: 3800
} as unknown as ReplayRecording;

const game = (matchId: string, queue: string) => ({ matchId, queue, date: 0 }) as unknown as AnalysisGame;

describe('GameStoryComponent', () => {
  const timelines = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map());
  const recordings = signal<ReadonlyMap<string, ReplayRecording | null>>(new Map());
  let loadTimeline: ReturnType<typeof vi.fn>;
  let loadRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    timelines.set(new Map());
    recordings.set(new Map());
    loadTimeline = vi.fn(async (id: string) => {
      timelines.update((m) => new Map(m).set(id, id === RIOT ? timeline : null));
      return timelines().get(id) ?? null;
    });
    loadRecording = vi.fn(async (id: string) => {
      recordings.update((m) => new Map(m).set(id, id === REPLAY ? recording : null));
      return recordings().get(id) ?? null;
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: MatchTimelineService, useValue: { known: timelines, load: loadTimeline, forget: () => undefined } },
        {
          provide: ReplayRecordingService,
          useValue: {
            known: recordings,
            load: loadRecording,
            recordingFor: (id: string | undefined) => (id ? recordings().get(id) : undefined),
            shotFor: () => undefined,
            loadShot: vi.fn(),
            has: (id: string | undefined) => !!(id && recordings().get(id))
          }
        }
      ]
    });
  });

  function mount(matchId: string, queue: string): ComponentFixture<GameStoryComponent> {
    const fixture = TestBed.createComponent(GameStoryComponent);
    fixture.componentRef.setInput('game', game(matchId, queue));
    fixture.detectChanges();
    return fixture;
  }

  async function openDrawer(fixture: ComponentFixture<GameStoryComponent>) {
    const drawer = (fixture.nativeElement as HTMLElement).querySelector('details')!;
    drawer.open = true;
    drawer.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lines = (fixture: ComponentFixture<GameStoryComponent>) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.game-story-lines li')).map((li) => li.textContent?.trim());

  it('reads nothing until the drawer is opened', () => {
    mount(RIOT, 'Flex');
    expect(loadTimeline).not.toHaveBeenCalled();
    expect(loadRecording).not.toHaveBeenCalled();
  });

  it('shows the timeline\'s lines for a Riot game', async () => {
    const fixture = mount(RIOT, 'Flex');
    await openDrawer(fixture);
    expect(loadTimeline).toHaveBeenCalledWith(RIOT);
    expect(lines(fixture)).toEqual(['Lost after leading at ten.', 'Mid lost the lane by 800 gold at ten.']);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('summary')?.textContent).toContain('from the timeline');
    expect(el.querySelector('.gold-spark')).not.toBeNull();
  });

  it('shows the recording\'s lines for a replay game, and never asks Riot for a timeline it cannot have', async () => {
    const fixture = mount(REPLAY, 'Scrim');
    await openDrawer(fixture);
    expect(loadTimeline).not.toHaveBeenCalled();
    expect(loadRecording).toHaveBeenCalledWith(REPLAY);
    // The recorder's own sentences, in time order — and not the two head lines the review's prompt gets.
    expect(lines(fixture)).toEqual(['Minute 18: Ruan (Top) died to a gank.', 'Minute 20: Baron, to them.', 'Minute 31: We won in 31 minutes.']);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('summary')?.textContent).toContain('from the replay recorder');
    expect(el.textContent).toContain('Recorded off the replay');
    expect(el.textContent).not.toContain('This game was recorded from the replay by');
    // Nothing minute-by-minute is claimed: no curve, no lane table, and no gold figure in any line.
    expect(el.querySelector('.gold-spark')).toBeNull();
    expect(el.querySelector('.game-story-lanes')).toBeNull();
    expect(lines(fixture).join(' ')).not.toMatch(/gold/i);
  });

  it('falls back to the totals sentence for a replay game nobody recorded', async () => {
    const fixture = mount('EUW1-none', 'Scrim');
    await openDrawer(fixture);
    expect(loadRecording).toHaveBeenCalledWith('EUW1-none');
    expect(lines(fixture)).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('End-of-game totals only');
  });

  // The recording is read for every opened drawer, Riot game or not, and for
  // a Riot game that read comes back empty. Letting it blank the body meant
  // "Reading the game…" over the curve and the lane table the drawer already
  // had, on every Riot game's first open (11 Sep 2026).
  it('draws the timeline it already has while the recording read is still in flight', async () => {
    // A recording read that never settles: the drawer must not wait on it.
    loadRecording.mockImplementation(() => new Promise(() => undefined));
    timelines.set(new Map([[RIOT, timeline]]));
    const fixture = mount(RIOT, 'Flex');
    await openDrawer(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Reading the game…');
    expect(el.querySelector('.gold-spark')).not.toBeNull();
    expect(lines(fixture)).toEqual(['Lost after leading at ten.', 'Mid lost the lane by 800 gold at ten.']);
  });

  it('says a Riot game is still waiting for its timeline', async () => {
    const fixture = mount('EUW1_7000000009', 'Flex');
    await openDrawer(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No timeline yet.');
  });
});

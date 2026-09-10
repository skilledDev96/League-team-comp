import { pick } from './seed';

/**
 * How one film looks and moves (10 Sep 2026). Every field is drawn from the
 * match id through `pick` with its own salt, so two games never look quite
 * the same and one game looks the same on every visit and every device.
 * Nothing here touches the coach's words or tints the map: a stock is
 * chrome, type and motion; a voice is the chrome's strings only.
 *
 * The stylesheet reads the stock, the title treatment, the motion family
 * and the entrance as classes on `.film-stage` (`stageClasses`), with the
 * tempo and the ease as inline custom properties the page sets. The build
 * reads the death order straight off the style; the tape reads the rate as
 * the speed step the film opens at (`TAPE_SPEEDS`, `defaultSpeedFor`).
 */

export type FilmStock = 'broadcast' | 'noir' | 'blueprint';
export type FilmTitleTreatment = 'word-rise' | 'curtain' | 'stamp';
export type FilmMotion = 'snappy' | 'soft';
export type FilmEntrance = 'drop' | 'rise' | 'zoom';
export type FilmDeathOrder = 'chronological' | 'worst-first';
export type FilmTapeRate = 0.85 | 1 | 1.25;
export type FilmVoiceIndex = 0 | 1 | 2;

export interface FilmStyle {
  stock: FilmStock;
  title: FilmTitleTreatment;
  motion: FilmMotion;
  entrance: FilmEntrance;
  deathOrder: FilmDeathOrder;
  /** The stock's own pace: since 10 Sep 2026 the speed step the tape opens at (`defaultSpeedFor`), not a fixed rate; the viewer's pick among `TAPE_SPEEDS` wins over it. */
  tapeRate: FilmTapeRate;
  voice: FilmVoiceIndex;
}

/**
 * The speeds the tape offers (10 Sep 2026: the lead watched the tape at the
 * old 1.2 s a game minute and said it ran too fast), as real seconds per
 * game minute, which is what `createFilmClock` and `setRate` take. A
 * thirty-minute game runs three minutes at ½×, ninety seconds at 1×,
 * forty-five at 2× and twenty-two at 4×. The tape remembers the viewer's
 * pick under `TAPE_SPEED_STORAGE_KEY`; until they pick, a film opens at 1×,
 * or at ½× when its stock is the slow one (`defaultSpeedFor`), so two games
 * still do not run quite alike; never faster than 1× on its own, since 2×
 * is 1.5 s a game minute, a hair under the pace the lead called too fast
 * (second fix pass, 10 Sep 2026).
 */
export const TAPE_SPEEDS = [
  { key: 'slow', label: '½×', secPerGameMinute: 6 },
  { key: 'normal', label: '1×', secPerGameMinute: 3 },
  { key: 'fast', label: '2×', secPerGameMinute: 1.5 },
  { key: 'faster', label: '4×', secPerGameMinute: 0.75 }
] as const;
export type FilmTapeSpeed = (typeof TAPE_SPEEDS)[number];
export type FilmTapeSpeedKey = FilmTapeSpeed['key'];
/** Where the tape keeps the viewer's speed, per browser; the value is a `FilmTapeSpeedKey`, and anything else falls back to the film's default. */
export const TAPE_SPEED_STORAGE_KEY = 'bom-film-speed';

/**
 * The stock's own pace as one of the steps: a film drawn slow (1.25 on the old base) opens at ½×, the rest at 1×, so a slow
 * film keeps its character until the viewer picks. A brisk stock (0.85) opened at 2× until the second fix pass (10 Sep 2026):
 * that is 1.5 s a game minute against the 1.2 s the lead said ran too fast, and one film in three drew that stock.
 */
export function defaultSpeedFor(style: Pick<FilmStyle, 'tapeRate'>): FilmTapeSpeedKey {
  return style.tapeRate === 1.25 ? 'slow' : 'normal';
}

/** The step a stored key names, else the film's default: an old or hand-edited value in storage never stalls the clock on a rate it cannot take. */
export function tapeSpeedFor(key: string | null | undefined, style: Pick<FilmStyle, 'tapeRate'>): FilmTapeSpeed {
  return TAPE_SPEEDS.find((s) => s.key === key) ?? TAPE_SPEEDS.find((s) => s.key === defaultSpeedFor(style))!;
}

/** A win leans broadcast, a loss leans noir; blueprint is the seed's alone. */
export const WIN_STOCKS: readonly FilmStock[] = ['broadcast', 'broadcast', 'noir', 'blueprint'];
export const LOSS_STOCKS: readonly FilmStock[] = ['noir', 'noir', 'broadcast', 'blueprint'];
export const TITLE_TREATMENTS: readonly FilmTitleTreatment[] = ['word-rise', 'curtain', 'stamp'];
export const MOTIONS: readonly FilmMotion[] = ['snappy', 'soft'];
export const ENTRANCES: readonly FilmEntrance[] = ['drop', 'rise', 'zoom'];
export const DEATH_ORDERS: readonly FilmDeathOrder[] = ['chronological', 'worst-first'];
export const TAPE_RATES: readonly FilmTapeRate[] = [0.85, 1, 1.25];
export const VOICE_INDEXES: readonly FilmVoiceIndex[] = [0, 1, 2];

/** The salt of each draw. Adding a field means adding a salt, never reusing one: an old draw must not move. */
export const STYLE_SALTS = {
  stock: 'stock',
  title: 'title',
  motion: 'motion',
  entrance: 'entrance',
  deathOrder: 'death-order',
  tapeRate: 'tape-rate',
  voice: 'voice'
} as const;

export function styleFor(seed: number, win: boolean): FilmStyle {
  return {
    stock: pick(seed, win ? WIN_STOCKS : LOSS_STOCKS, STYLE_SALTS.stock),
    title: pick(seed, TITLE_TREATMENTS, STYLE_SALTS.title),
    motion: pick(seed, MOTIONS, STYLE_SALTS.motion),
    entrance: pick(seed, ENTRANCES, STYLE_SALTS.entrance),
    deathOrder: pick(seed, DEATH_ORDERS, STYLE_SALTS.deathOrder),
    tapeRate: pick(seed, TAPE_RATES, STYLE_SALTS.tapeRate),
    voice: pick(seed, VOICE_INDEXES, STYLE_SALTS.voice)
  };
}

/** The chrome's strings: the pills and the one question the tape asks. Never the coach's text. */
export interface FilmVoice {
  /** Over the scrubber before the curve shows. */
  turnQuestion: string;
  lockPill: string;
  revealPill: string;
  nextDeath: string;
  watchIt: string;
  /** The tape's pill after a moment has been read. */
  momentContinue: string;
}

export const VOICES: readonly [FilmVoice, FilmVoice, FilmVoice] = [
  { turnQuestion: 'Where did it turn? Drag, then lock', lockPill: 'Lock', revealPill: 'Reveal', nextDeath: 'Next death', watchIt: 'Watch it', momentContinue: 'Continue' },
  { turnQuestion: 'Call the turning point', lockPill: 'Lock it in', revealPill: 'Show me', nextDeath: 'Next one', watchIt: 'Roll it back', momentContinue: 'Play on' },
  { turnQuestion: 'When did it go?', lockPill: 'Mark it', revealPill: 'Roll tape', nextDeath: 'And the next', watchIt: 'See it happen', momentContinue: 'Keep rolling' }
];

export function voiceOf(style: FilmStyle): FilmVoice {
  return VOICES[style.voice] ?? VOICES[0];
}

/** The classes the stage carries: `stock-broadcast title-curtain motion-soft enter-rise`. */
export function stageClasses(style: FilmStyle): string[] {
  return ['stock-' + style.stock, 'title-' + style.title, 'motion-' + style.motion, 'enter-' + style.entrance];
}

/** `--film-tempo`: how many times its written length every duration in the film runs. */
export function tempoOf(style: FilmStyle): number {
  return style.motion === 'snappy' ? 0.85 : 1.15;
}

/** `--film-ease`: the curve every transition and entrance in the film follows. */
export function easeOf(style: FilmStyle): string {
  return style.motion === 'snappy' ? 'cubic-bezier(.2,.9,.3,1)' : 'cubic-bezier(.4,0,.2,1)';
}

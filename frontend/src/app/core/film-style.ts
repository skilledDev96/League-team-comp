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
 * reads the death order and the tape rate straight off the style.
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
  /** Real seconds per game minute on the tape, as a factor on the chapter's base rate. */
  tapeRate: FilmTapeRate;
  voice: FilmVoiceIndex;
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

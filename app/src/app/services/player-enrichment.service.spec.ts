import { describe, expect, it } from 'vitest';
import { PlayerEnrichmentService } from './player-enrichment.service';

// No constructor dependencies, so the pure merge logic can be exercised directly.
const service = new PlayerEnrichmentService();

describe('mergeChampionPool', () => {
  it('appends champions Riot reports that we do not already have', () => {
    const merged = service.mergeChampionPool(['Yorick', 'Lucian'], ['Trundle', 'Ornn']);
    expect(merged).toEqual(['Yorick', 'Lucian', 'Trundle', 'Ornn']);
  });

  it('keeps the curated order, so the Main Champion stays first', () => {
    const merged = service.mergeChampionPool(['Trundle', 'Yorick'], ['Yorick', 'Mordekaiser']);
    expect(merged[0]).toBe('Trundle');
    expect(merged).toEqual(['Trundle', 'Yorick', 'Mordekaiser']);
  });

  it('does not duplicate a champion that is already in the pool', () => {
    const merged = service.mergeChampionPool(['Yorick'], ['Yorick']);
    expect(merged).toEqual(['Yorick']);
  });

  it('treats punctuation and casing as the same champion', () => {
    const merged = service.mergeChampionPool(["Kai'Sa", 'Miss Fortune'], ['kaisa', 'missfortune']);
    expect(merged).toEqual(["Kai'Sa", 'Miss Fortune']);
  });

  it('never shrinks a hand-curated pool', () => {
    const curated = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const merged = service.mergeChampionPool(curated, ['A', 'B']);
    expect(merged).toEqual(curated);
  });

  it('handles missing values on either side', () => {
    expect(service.mergeChampionPool(undefined, ['Yorick'])).toEqual(['Yorick']);
    expect(service.mergeChampionPool(['Yorick'], undefined)).toEqual(['Yorick']);
    expect(service.mergeChampionPool(undefined, undefined)).toEqual([]);
  });
});

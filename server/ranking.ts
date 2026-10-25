import type { RankingRow } from './types.js';

export function sortRanking(rows: RankingRow[]): RankingRow[] {
  return [...rows].sort(
    (a, b) =>
      b.juryAverage - a.juryAverage ||
      b.publicVotesCount - a.publicVotesCount ||
      b.creativityAverage - a.creativityAverage ||
      b.executionAverage - a.executionAverage ||
      a.studentName.localeCompare(b.studentName),
  );
}

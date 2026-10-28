import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CandidateEvaluationItemDto } from './dto.js';
import { sortRanking } from './ranking.js';
import type { RankingRow } from './types.js';
import { validateDto } from './validation.js';

function rankingRow(
  candidateId: string,
  overrides: Partial<RankingRow> = {},
): RankingRow {
  return {
    candidateId,
    intranetLogin: candidateId,
    studentName: candidateId,
    costumeName: candidateId,
    juryAverage: 0,
    creativityAverage: 0,
    executionAverage: 0,
    publicVotesCount: 0,
    evaluationsCount: 0,
    judgeNotes: [],
    ...overrides,
  };
}

test('ordena pelo critério principal e pelos desempates na ordem especificada', () => {
  const rows = [
    rankingRow('execution', { juryAverage: 40, publicVotesCount: 3, creativityAverage: 12, executionAverage: 14 }),
    rankingRow('creativity', { juryAverage: 40, publicVotesCount: 3, creativityAverage: 13, executionAverage: 1 }),
    rankingRow('votes', { juryAverage: 40, publicVotesCount: 4, creativityAverage: 0, executionAverage: 0 }),
    rankingRow('jury', { juryAverage: 41, publicVotesCount: 0, creativityAverage: 0, executionAverage: 0 }),
  ];
  assert.deepEqual(sortRanking(rows).map((row) => row.candidateId), [
    'jury',
    'votes',
    'creativity',
    'execution',
  ]);
});

test('valida os limites e os tipos das notas do DTO de avaliação', async () => {
  const valid = await validateDto(CandidateEvaluationItemDto, {
    candidateId: 'e54e48a7-d11a-4be9-95b8-68e343ad6d2e',
    creativityScore: 14.5,
    executionScore: 15,
    visualImpactScore: 10,
    performanceScore: 5,
    themeFidelityScore: 5,
    notes: 'Boa execução',
  });
  assert.equal(valid.creativityScore, 14.5);
  await assert.rejects(
    validateDto(CandidateEvaluationItemDto, {
      candidateId: 'e54e48a7-d11a-4be9-95b8-68e343ad6d2e',
      creativityScore: 16,
      executionScore: 15,
      visualImpactScore: 10,
      performanceScore: 5,
      themeFidelityScore: 5,
    }),
    /must not be greater than 15/,
  );
});

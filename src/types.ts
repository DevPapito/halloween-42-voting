export type VotingStatus = 'NOT_STARTED' | 'OPEN' | 'CLOSED';

export interface Candidate {
  id: string;
  intranetLogin: string;
  studentName: string;
  costumeName: string;
  createdAt: string;
}

export interface Evaluation {
  id: string;
  candidateId: string;
  creativityScore: number;
  executionScore: number;
  visualImpactScore: number;
  performanceScore: number;
  themeFidelityScore: number;
  notes?: string;
}

export interface EvaluationDraft {
  candidateId: string;
  creativityScore: number;
  executionScore: number;
  visualImpactScore: number;
  performanceScore: number;
  themeFidelityScore: number;
  notes: string;
}

export interface RankingRow {
  candidateId: string;
  intranetLogin: string;
  studentName: string;
  costumeName: string;
  juryAverage: number;
  creativityAverage: number;
  executionAverage: number;
  publicVotesCount: number;
  evaluationsCount: number;
  judgeNotes: Array<{ judgeName: string; notes: string }>;
}

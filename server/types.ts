export type VotingStatus = 'NOT_STARTED' | 'OPEN' | 'CLOSED';
export type JudgeStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface Candidate {
  id: string;
  intranetLogin: string;
  studentName: string;
  costumeName: string;
  createdAt: string;
}

export interface Judge {
  id: string;
  name: string;
  pinCode: string;
  status: JudgeStatus;
  createdAt: string;
}

export interface Device {
  id: string;
  deviceToken: string;
  hasVoted: boolean;
  createdAt: string;
}

export interface PublicVote {
  id: string;
  deviceId: string;
  candidateId: string;
  createdAt: string;
}

export interface EvaluationScores {
  creativityScore: number;
  executionScore: number;
  visualImpactScore: number;
  performanceScore: number;
  themeFidelityScore: number;
  notes?: string;
}

export interface Evaluation extends EvaluationScores {
  id: string;
  judgeId: string;
  candidateId: string;
  updatedAt: string;
}

export interface StoreData {
  votingStatus: VotingStatus;
  candidates: Candidate[];
  judges: Judge[];
  devices: Device[];
  votes: PublicVote[];
  evaluations: Evaluation[];
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
}

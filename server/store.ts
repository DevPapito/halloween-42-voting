import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { HttpError } from './errors.js';
import { sortRanking } from './ranking.js';
import type {
  Candidate,
  Evaluation,
  EvaluationScores,
  Judge,
  RankingRow,
  VotingStatus,
} from './types.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatório para conectar ao Supabase PostgreSQL.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: { rejectUnauthorized: false },
});

interface CandidateRow extends QueryResultRow {
  id: string;
  intranet_login: string;
  student_name: string;
  costume_name: string;
  created_at: Date;
}

interface JudgeRow extends QueryResultRow {
  id: string;
  name: string;
  pin_hash?: string;
  pin_encrypted?: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  created_at: Date;
}

interface EvaluationRow extends QueryResultRow {
  id: string;
  judge_id: string;
  candidate_id: string;
  creativity_score: string | number;
  execution_score: string | number;
  visual_impact_score: string | number;
  performance_score: string | number;
  theme_fidelity_score: string | number;
  notes: string | null;
  updated_at: Date;
  total_score: string | number;
}

function candidateFromRow(row: CandidateRow): Candidate {
  return {
    id: row.id,
    intranetLogin: row.intranet_login,
    studentName: row.student_name,
    costumeName: row.costume_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function judgeFromRow(row: JudgeRow, pinCode = ''): Judge {
  return {
    id: row.id,
    name: row.name,
    pinCode,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function evaluationFromRow(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    judgeId: row.judge_id,
    candidateId: row.candidate_id,
    creativityScore: Number(row.creativity_score),
    executionScore: Number(row.execution_score),
    visualImpactScore: Number(row.visual_impact_score),
    performanceScore: Number(row.performance_score),
    themeFidelityScore: Number(row.theme_fidelity_score),
    notes: row.notes ?? undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapDatabaseError(error: unknown): HttpError {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    const message = 'message' in error ? String(error.message) : '';
    if (code === '23505') return new HttpError(409, 'Já existe um registro com esses dados.');
    if (code === '23503') return new HttpError(400, 'O registro associado não existe mais.');
    if (code === 'P0001') {
      if (message === 'VOTING_NOT_OPEN') return new HttpError(403, 'A votação não está aberta.');
      if (message === 'DEVICE_NOT_FOUND') return new HttpError(400, 'Dispositivo inválido. Atualize a página e tente novamente.');
      if (message === 'DEVICE_ALREADY_VOTED') return new HttpError(409, 'Este dispositivo já registrou um voto.');
      if (message === 'CANDIDATE_NOT_FOUND') return new HttpError(404, 'Candidato não encontrado.');
      if (message === 'JUDGE_NOT_FOUND') return new HttpError(404, 'Jurado não encontrado.');
      if (message === 'JUDGE_ALREADY_COMPLETED') return new HttpError(409, 'A avaliação já foi finalizada e está bloqueada.');
      if (message === 'EVALUATION_SET_MISMATCH') {
        return new HttpError(400, 'É necessário enviar uma avaliação para cada candidato, uma única vez.');
      }
    }
    console.error('PostgreSQL request failed:', code, message);
  } else {
    console.error('PostgreSQL request failed:', error);
  }
  return new HttpError(500, 'Não foi possível acessar os dados do evento. Tente novamente.');
}

async function query<T extends QueryResultRow>(
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(statement, values);
    return result.rows;
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

function normalizeCandidateInput(input: Omit<Candidate, 'id' | 'createdAt'>) {
  const values = {
    intranetLogin: input.intranetLogin.trim(),
    studentName: input.studentName.trim(),
    costumeName: input.costumeName.trim(),
  };
  if (Object.values(values).some((value) => !value)) {
    throw new HttpError(400, 'Preencha todos os campos do candidato.');
  }
  return values;
}

function pinHash(pinCode: string): string {
  return createHash('sha256').update(pinCode.trim().toUpperCase()).digest('hex');
}

function pinEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres para proteger os PINs.');
  }
  return createHash('sha256').update(secret).digest();
}

function encryptPin(pinCode: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pinEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(pinCode, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptPin(encryptedPin: string | null | undefined): string | null {
  if (!encryptedPin) return null;
  try {
    const [iv, authTag, encrypted] = encryptedPin.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !authTag || !encrypted || iv.length !== 12 || authTag.length !== 16) {
      throw new Error('Formato de PIN criptografado inválido.');
    }
    const decipher = createDecipheriv('aes-256-gcm', pinEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    console.error('Failed to decrypt judge PIN:', error);
    throw new HttpError(500, 'Não foi possível descriptografar o PIN. Verifique o SESSION_SECRET.');
  }
}

type AdminJudge = Omit<Judge, 'pinCode'> & { pinCode: string | null };

export class VotingStore {
  async getPublicSettings(): Promise<{ votingStatus: VotingStatus; showQrCode: boolean }> {
    const rows = await query<{ voting_status: VotingStatus; show_qr_code: boolean }>(
      'select voting_status, show_qr_code from public.global_settings where id = 1',
    );
    if (!rows[0]) throw new HttpError(500, 'A configuração global do evento não foi encontrada.');
    return { votingStatus: rows[0].voting_status, showQrCode: rows[0].show_qr_code };
  }

  async getStatus(): Promise<VotingStatus> {
    const rows = await query<{ voting_status: VotingStatus }>(
      'select voting_status from public.global_settings where id = 1',
    );
    if (!rows[0]) throw new HttpError(500, 'A configuração global do evento não foi encontrada.');
    return rows[0].voting_status;
  }

  async setStatus(status: VotingStatus): Promise<void> {
    await query(
      `insert into public.global_settings (id, voting_status)
       values (1, $1::public.voting_status_enum)
       on conflict (id) do update set voting_status = excluded.voting_status`,
      [status],
    );
  }

  async setQrCodeVisibility(visible: boolean): Promise<void> {
    await query(
      `insert into public.global_settings (id, show_qr_code)
       values (1, $1)
       on conflict (id) do update set show_qr_code = excluded.show_qr_code`,
      [visible],
    );
  }

  async listCandidates(): Promise<Candidate[]> {
    const rows = await query<CandidateRow>(
      'select id, intranet_login, student_name, costume_name, created_at from public.candidates order by student_name',
    );
    return rows.map(candidateFromRow);
  }

  async createCandidate(input: Omit<Candidate, 'id' | 'createdAt'>): Promise<Candidate> {
    const candidate = normalizeCandidateInput(input);
    const rows = await query<CandidateRow>(
      `insert into public.candidates (intranet_login, student_name, costume_name)
       values ($1, $2, $3)
       returning id, intranet_login, student_name, costume_name, created_at`,
      [candidate.intranetLogin, candidate.studentName, candidate.costumeName],
    );
    return candidateFromRow(rows[0]!);
  }

  async updateCandidate(candidateId: string, input: Omit<Candidate, 'id' | 'createdAt'>): Promise<Candidate> {
    const candidate = normalizeCandidateInput(input);
    const rows = await query<CandidateRow>(
      `update public.candidates
       set intranet_login = $2, student_name = $3, costume_name = $4
       where id = $1
       returning id, intranet_login, student_name, costume_name, created_at`,
      [candidateId, candidate.intranetLogin, candidate.studentName, candidate.costumeName],
    );
    if (!rows[0]) throw new HttpError(404, 'Candidato não encontrado.');
    return candidateFromRow(rows[0]);
  }

  async deleteCandidate(candidateId: string): Promise<void> {
    const rows = await query<{ id: string }>(
      'delete from public.candidates where id = $1 returning id',
      [candidateId],
    );
    if (!rows[0]) throw new HttpError(404, 'Candidato não encontrado.');
  }

  async listJudges(): Promise<AdminJudge[]> {
    const rows = await query<JudgeRow>(
      'select id, name, pin_encrypted, status, created_at from public.judges order by created_at',
    );
    return rows.map((row) => ({
      ...judgeFromRow(row),
      pinCode: decryptPin(row.pin_encrypted),
    }));
  }

  async createJudge(name: string): Promise<Judge> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new HttpError(400, 'Informe o nome do jurado.');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pinCode = randomBytes(4).toString('hex').toUpperCase();
      try {
        const rows = await query<JudgeRow>(
          `insert into public.judges (name, pin_hash, pin_encrypted)
           values ($1, $2, $3)
           returning id, name, status, created_at`,
          [trimmedName, pinHash(pinCode), encryptPin(pinCode)],
        );
        return judgeFromRow(rows[0]!, pinCode);
      } catch (error) {
        if (error instanceof HttpError && error.status === 409 && attempt < 4) continue;
        throw error;
      }
    }
    throw new HttpError(500, 'Não foi possível gerar um PIN exclusivo. Tente novamente.');
  }

  async regenerateJudgePin(judgeId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pinCode = randomBytes(4).toString('hex').toUpperCase();
      try {
        const rows = await query<{ id: string }>(
          `update public.judges
           set pin_hash = $2, pin_encrypted = $3
           where id = $1
           returning id`,
          [judgeId, pinHash(pinCode), encryptPin(pinCode)],
        );
        if (!rows[0]) throw new HttpError(404, 'Jurado não encontrado.');
        return pinCode;
      } catch (error) {
        if (error instanceof HttpError && error.status === 409 && attempt < 4) continue;
        throw error;
      }
    }
    throw new HttpError(500, 'Não foi possível gerar um PIN exclusivo. Tente novamente.');
  }

  async deleteJudge(judgeId: string): Promise<void> {
    const rows = await query<{ id: string }>('delete from public.judges where id = $1 returning id', [judgeId]);
    if (!rows[0]) throw new HttpError(404, 'Jurado não encontrado.');
  }

  async findJudgeByPin(pinCode: string): Promise<Judge | undefined> {
    const rows = await query<JudgeRow>(
      `select id, name, status, created_at from public.judges where pin_hash = $1`,
      [pinHash(pinCode)],
    );
    return rows[0] ? judgeFromRow(rows[0]) : undefined;
  }

  async findJudge(judgeId: string): Promise<Judge | undefined> {
    const rows = await query<JudgeRow>(
      'select id, name, status, created_at from public.judges where id = $1',
      [judgeId],
    );
    return rows[0] ? judgeFromRow(rows[0]) : undefined;
  }

  async createJudgeSession(judgeId: string, sessionToken: string): Promise<void> {
    await query(
      `insert into public.judge_sessions (token_hash, judge_id, expires_at)
       values ($1, $2, now() + interval '12 hours')`,
      [createHash('sha256').update(sessionToken).digest('hex'), judgeId],
    );
  }

  async findJudgeBySession(sessionToken: string): Promise<Judge | undefined> {
    const rows = await query<JudgeRow>(
      `select j.id, j.name, j.status, j.created_at
       from public.judge_sessions s
       join public.judges j on j.id = s.judge_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [createHash('sha256').update(sessionToken).digest('hex')],
    );
    return rows[0] ? judgeFromRow(rows[0]) : undefined;
  }

  async listEvaluations(judgeId: string): Promise<Evaluation[]> {
    const rows = await query<EvaluationRow>(
      `select id, judge_id, candidate_id, creativity_score, execution_score,
              visual_impact_score, performance_score, theme_fidelity_score,
              notes, updated_at, total_score
       from public.evaluations where judge_id = $1`,
      [judgeId],
    );
    return rows.map(evaluationFromRow);
  }

  async saveEvaluations(
    judgeId: string,
    evaluations: Array<EvaluationScores & { candidateId: string }>,
  ): Promise<void> {
    try {
      await pool.query('select public.finalize_judge_evaluations($1::uuid, $2::jsonb)', [
        judgeId,
        JSON.stringify(
          evaluations.map((item) => ({
            candidate_id: item.candidateId,
            creativity_score: item.creativityScore,
            execution_score: item.executionScore,
            visual_impact_score: item.visualImpactScore,
            performance_score: item.performanceScore,
            theme_fidelity_score: item.themeFidelityScore,
            notes: item.notes ?? null,
          })),
        ),
      ]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async registerDevice(): Promise<string> {
    const deviceToken = randomUUID();
    await query('insert into public.devices (device_token) values ($1)', [deviceToken]);
    return deviceToken;
  }

  async hasVoted(deviceToken: string): Promise<boolean> {
    const rows = await query<{ has_voted: boolean }>(
      'select has_voted from public.devices where device_token = $1',
      [deviceToken],
    );
    return rows[0]?.has_voted ?? false;
  }

  async submitVote(deviceToken: string, candidateId: string): Promise<void> {
    try {
      await pool.query('select public.submit_public_vote($1::uuid, $2::uuid)', [deviceToken, candidateId]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async getRanking(): Promise<RankingRow[]> {
    const [candidateRows, evaluationRows, voteRows] = await Promise.all([
      query<CandidateRow>(
        'select id, intranet_login, student_name, costume_name, created_at from public.candidates',
      ),
      query<EvaluationRow>(
        'select candidate_id, creativity_score, execution_score, total_score from public.evaluations',
      ),
      query<{ candidate_id: string }>('select candidate_id from public.votes'),
    ]);

    const evaluationsByCandidate = new Map<
      string,
      Array<{ creativity: number; execution: number; total: number }>
    >();
    for (const evaluation of evaluationRows) {
      const current = evaluationsByCandidate.get(evaluation.candidate_id) ?? [];
      current.push({
        creativity: Number(evaluation.creativity_score),
        execution: Number(evaluation.execution_score),
        total: Number(evaluation.total_score),
      });
      evaluationsByCandidate.set(evaluation.candidate_id, current);
    }
    const votesByCandidate = new Map<string, number>();
    for (const vote of voteRows) {
      votesByCandidate.set(vote.candidate_id, (votesByCandidate.get(vote.candidate_id) ?? 0) + 1);
    }
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

    const rows = candidateRows.map((candidate): RankingRow => {
      const evaluations = evaluationsByCandidate.get(candidate.id) ?? [];
      const average = (select: (item: (typeof evaluations)[number]) => number) =>
        evaluations.length ? round(evaluations.reduce((sum, item) => sum + select(item), 0) / evaluations.length) : 0;
      return {
        candidateId: candidate.id,
        intranetLogin: candidate.intranet_login,
        studentName: candidate.student_name,
        costumeName: candidate.costume_name,
        juryAverage: average((item) => item.total),
        creativityAverage: average((item) => item.creativity),
        executionAverage: average((item) => item.execution),
        publicVotesCount: votesByCandidate.get(candidate.id) ?? 0,
        evaluationsCount: evaluations.length,
      };
    });
    return sortRanking(rows);
  }

  async getSummary() {
    const rows = await query<{
      candidate_count: string;
      judge_count: string;
      completed_judge_count: string;
      vote_count: string;
      voting_status: VotingStatus;
      show_qr_code: boolean;
    }>(
      `select
         (select count(*) from public.candidates) as candidate_count,
         (select count(*) from public.judges) as judge_count,
         (select count(*) from public.judges where status = 'COMPLETED') as completed_judge_count,
         (select count(*) from public.votes) as vote_count,
         (select voting_status from public.global_settings where id = 1) as voting_status,
         (select show_qr_code from public.global_settings where id = 1) as show_qr_code`,
    );
    const row = rows[0];
    if (!row) throw new HttpError(500, 'Não foi possível carregar o resumo do evento.');
    return {
      votingStatus: row.voting_status,
      showQrCode: row.show_qr_code,
      candidateCount: Number(row.candidate_count),
      judgeCount: Number(row.judge_count),
      completedJudgeCount: Number(row.completed_judge_count),
      voteCount: Number(row.vote_count),
    };
  }
}

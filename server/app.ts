import './env.js';
import 'reflect-metadata';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError } from './errors.js';
import {
  CreateCandidateDto,
  CreateJudgeDto,
  JudgeLoginDto,
  SubmitJudgeEvaluationsDto,
  SubmitPublicVoteDto,
  UpdateCandidateDto,
  UpdateQrCodeVisibilityDto,
  UpdateVotingStatusDto,
} from './dto.js';
import { VotingStore } from './store.js';
import { validateDto } from './validation.js';
import { createAdminSession, requireSessionConfiguration, verifyAdminSession } from './admin-session.js';
import { createEventMediaUpload, getPublicEventMediaUrl, verifyUploadedEventMedia, isEventMediaType } from './event-media.js';

const app = express();
const store = new VotingStore();
requireSessionConfiguration();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function routeParameter(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new HttpError(400, 'Parâmetro de rota inválido.');
  return value;
}

function requireAdmin(request: Request, _response: Response, next: NextFunction): void {
  const authorization = request.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!verifyAdminSession(token)) {
    next(new HttpError(401, 'Token administrativo inválido.'));
    return;
  }
  next();
}

app.post('/api/v1/admin/login', async (request, response) => {
  const username = typeof request.body?.username === 'string' ? request.body.username : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  const configuredUsername = process.env.ADMIN_USERNAME;
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredUsername || !configuredPassword) {
    throw new Error('ADMIN_USERNAME e ADMIN_PASSWORD devem estar configurados.');
  }
  if (!secureEqual(username, configuredUsername) || !secureEqual(password, configuredPassword)) {
    throw new HttpError(401, 'Usuário ou senha inválidos.');
  }
  response.json({ token: createAdminSession(username) });
});

async function requireJudge(request: Request, _response: Response, next: NextFunction): Promise<void> {
  const authorization = request.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  try {
    const judge = token ? await store.findJudgeBySession(token) : undefined;
    if (!judge) {
      next(new HttpError(401, 'Sessão de jurado inválida ou expirada.'));
      return;
    }
    if (judge.status === 'COMPLETED') {
      next(new HttpError(409, 'A avaliação deste jurado já foi finalizada.'));
      return;
    }
    request.judgeId = judge.id;
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/v1/public/state', async (_request, response) => {
  const settings = await store.getPublicSettings();
  response.json({
    status: settings.votingStatus,
    showQrCode: settings.showQrCode,
    displayMode: settings.displayMode,
    eventMediaType: settings.eventMediaType,
    eventMediaUrl: settings.eventMediaPath ? getPublicEventMediaUrl(settings.eventMediaPath) : null,
  });
});

app.get('/api/v1/public/candidates', async (_request, response) => {
  response.json({ candidates: await store.listCandidates() });
});

app.post('/api/v1/devices/register', async (_request, response) => {
  response.status(201).json({ deviceToken: await store.registerDevice() });
});

app.get('/api/v1/devices/:deviceToken', async (request, response) => {
  response.json({ hasVoted: await store.hasVoted(routeParameter(request, 'deviceToken')) });
});

app.post('/api/v1/votes', async (request, response) => {
  const dto = await validateDto(SubmitPublicVoteDto, request.body);
  await store.submitVote(dto.deviceToken, dto.candidateId);
  response.status(201).json({ message: 'Voto registrado com sucesso.' });
});

app.post('/api/v1/judges/login', async (request, response) => {
  const dto = await validateDto(JudgeLoginDto, request.body);
  const judge = await store.findJudgeByPin(dto.pinCode);
  if (!judge) throw new HttpError(401, 'PIN de jurado inválido.');
  if (judge.status === 'COMPLETED') throw new HttpError(409, 'Este jurado já finalizou a avaliação.');
  const token = randomBytes(32).toString('hex');
  await store.createJudgeSession(judge.id, token);
  response.json({
    token,
    judge: { id: judge.id, name: judge.name, status: judge.status },
    candidates: await store.listCandidates(),
    evaluations: await store.listEvaluations(judge.id),
  });
});

app.get('/api/v1/judges/evaluations', requireJudge, async (request, response) => {
  response.json({
    judgeId: request.judgeId,
    candidates: await store.listCandidates(),
    evaluations: await store.listEvaluations(request.judgeId!),
  });
});

app.post('/api/v1/judges/evaluations/finalize', requireJudge, async (request, response) => {
  const dto = await validateDto(SubmitJudgeEvaluationsDto, request.body);
  if (dto.judgeId !== request.judgeId) throw new HttpError(403, 'O jurado da avaliação não corresponde à sessão.');
  await store.saveEvaluations(dto.judgeId, dto.evaluations);
  response.json({ message: 'Avaliação finalizada. As notas foram bloqueadas.' });
});

app.get('/api/v1/admin/summary', requireAdmin, async (_request, response) => {
  const [summary, ranking] = await Promise.all([store.getSummary(), store.getRanking()]);
  response.json({ summary, ranking });
});

app.get('/api/v1/admin/candidates', requireAdmin, async (_request, response) => {
  response.json({ candidates: await store.listCandidates() });
});

app.post('/api/v1/admin/candidates', requireAdmin, async (request, response) => {
  const dto = await validateDto(CreateCandidateDto, request.body);
  response.status(201).json({
    candidate: await store.createCandidate({
      intranetLogin: dto.intranetLogin,
      studentName: dto.studentName,
      costumeName: dto.costumeName,
    }),
  });
});

app.patch('/api/v1/admin/candidates/:candidateId', requireAdmin, async (request, response) => {
  const dto = await validateDto(UpdateCandidateDto, request.body);
  response.json({
    candidate: await store.updateCandidate(routeParameter(request, 'candidateId'), {
      intranetLogin: dto.intranetLogin,
      studentName: dto.studentName,
      costumeName: dto.costumeName,
    }),
  });
});

app.delete('/api/v1/admin/candidates/:candidateId', requireAdmin, async (request, response) => {
  await store.deleteCandidate(routeParameter(request, 'candidateId'));
  response.status(204).end();
});

app.get('/api/v1/admin/judges', requireAdmin, async (_request, response) => {
  response.json({ judges: await store.listJudges() });
});

app.patch('/api/v1/admin/judges/:judgeId/pin', requireAdmin, async (request, response) => {
  const pinCode = await store.regenerateJudgePin(routeParameter(request, 'judgeId'));
  response.json({ pinCode });
});

app.post('/api/v1/admin/judges', requireAdmin, async (request, response) => {
  const dto = await validateDto(CreateJudgeDto, request.body);
  response.status(201).json({ judge: await store.createJudge(dto.name) });
});

app.delete('/api/v1/admin/judges/:judgeId', requireAdmin, async (request, response) => {
  await store.deleteJudge(routeParameter(request, 'judgeId'));
  response.status(204).end();
});

app.patch('/api/v1/admin/voting-status', requireAdmin, async (request, response) => {
  const dto = await validateDto(UpdateVotingStatusDto, request.body);
  await store.setStatus(dto.status);
  response.json({ status: await store.getStatus() });
});

app.patch('/api/v1/admin/qr-code', requireAdmin, async (request, response) => {
  const dto = await validateDto(UpdateQrCodeVisibilityDto, request.body);
  await store.setQrCodeVisibility(dto.visible);
  response.json({ showQrCode: dto.visible });
});

app.patch('/api/v1/admin/home-display', requireAdmin, async (request, response) => {
  const mode = request.body?.mode;
  if (mode !== 'HIDDEN' && mode !== 'QR' && mode !== 'MEDIA') {
    throw new HttpError(400, 'Modo de exibição inválido.');
  }
  if (mode === 'MEDIA' && !(await store.getPublicSettings()).eventMediaPath) {
    throw new HttpError(409, 'Envie uma imagem ou vídeo antes de exibi-lo na página inicial.');
  }
  await store.setHomeDisplayMode(mode);
  response.json({ displayMode: mode });
});

app.post('/api/v1/admin/event-media/upload-url', requireAdmin, async (request, response) => {
  const mediaType = request.body?.mediaType;
  const fileSize = request.body?.fileSize;
  if (!isEventMediaType(mediaType)) throw new HttpError(400, 'Formato de arquivo não suportado.');
  if (typeof fileSize !== 'number') throw new HttpError(400, 'Tamanho do arquivo inválido.');
  response.json(await createEventMediaUpload(mediaType, fileSize));
});

app.post('/api/v1/admin/event-media', requireAdmin, async (request, response) => {
  const media = await verifyUploadedEventMedia(request.body?.objectPath);
  await store.setEventMedia(media.mediaPath, media.mediaType);
  response.json({
    eventMediaType: media.mediaType,
    eventMediaUrl: getPublicEventMediaUrl(media.mediaPath),
  });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError) {
    response.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

declare global {
  namespace Express {
    interface Request {
      judgeId?: string;
    }
  }
}

export { app };

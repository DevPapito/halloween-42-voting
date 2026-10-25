import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError, bearer } from './api';
import type { Candidate, Evaluation, EvaluationDraft, RankingRow, VotingStatus } from './types';

const statusLabels: Record<VotingStatus, string> = {
  NOT_STARTED: 'Ainda não começou',
  OPEN: 'Votação aberta',
  CLOSED: 'Votação encerrada',
};

const scoreFields: Array<{ key: keyof Omit<EvaluationDraft, 'candidateId' | 'notes'>; label: string; max: number }> = [
  { key: 'creativityScore', label: 'Criatividade e originalidade', max: 15 },
  { key: 'executionScore', label: 'Execução e detalhes', max: 15 },
  { key: 'visualImpactScore', label: 'Impacto visual', max: 10 },
  { key: 'performanceScore', label: 'Presença cênica e atuação', max: 5 },
  { key: 'themeFidelityScore', label: 'Fidelidade ao tema', max: 5 },
];

function emptyDraft(candidateId: string): EvaluationDraft {
  return {
    candidateId,
    creativityScore: 0,
    executionScore: 0,
    visualImpactScore: 0,
    performanceScore: 0,
    themeFidelityScore: 0,
    notes: '',
  };
}

function draftFromEvaluation(candidateId: string, evaluation?: Evaluation): EvaluationDraft {
  return evaluation ? { ...emptyDraft(candidateId), ...evaluation, notes: evaluation.notes ?? '' } : emptyDraft(candidateId);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function BrandHeader() {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Halloween 42sp - início">
        <span className="brand-mark">42</span>
        <span>HALLOWEEN <strong>VOTING</strong></span>
      </a>
      <nav aria-label="Navegação principal">
        <a href="/votar">Votar</a>
        <a href="/jurado/avaliar">Jurado</a>
        <a href="/admin">Admin</a>
      </nav>
    </header>
  );
}

function Home() {
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeError, setQrCodeError] = useState('');

  useEffect(() => {
    let active = true;
    async function refreshVisibility() {
      try {
        const settings = await api<{ showQrCode: boolean }>('/api/v1/public/state');
        if (!active) return;
        setShowQrCode(settings.showQrCode);
        setQrCodeError('');
      } catch (error: unknown) {
        if (active) setQrCodeError(formatError(error));
      }
    }
    void refreshVisibility();
    const interval = window.setInterval(() => void refreshVisibility(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">42sp · CONCURSO DE FANTASIAS</p>
        <h1>Uma noite.<br /><span>Uma fantasia lendária.</span></h1>
        <p className="hero-copy">Acompanhe a votação do Halloween 42sp. Escolha sua fantasia favorita ou entre como jurado para avaliar cada detalhe.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/votar">Votar agora <span aria-hidden="true">↗</span></a>
          <a className="button button-outline" href="/jurado/avaliar">Área do jurado</a>
        </div>
      </section>
      {showQrCode && (
        <section className="home-qr-section" aria-labelledby="home-qr-title">
          <p className="eyebrow">VOTAÇÃO DA PLATEIA</p>
          <h2 id="home-qr-title">Aponte a câmera e vote.</h2>
          <div className="home-qr-code">
            <QRCodeSVG
              value={`${window.location.origin}/votar`}
              size={220}
              level="H"
              title="QR Code para votar no concurso Halloween 42sp"
            />
          </div>
          <p>Escaneie o QR Code para abrir a página de votação.</p>
          <a className="text-link" href="/votar">{window.location.origin}/votar</a>
        </section>
      )}
      {qrCodeError && <p className="qr-load-error" role="status">O QR Code está temporariamente indisponível.</p>}
      <section className="feature-grid" aria-label="Áreas do concurso">
        <a className="feature-card" href="/votar"><span className="feature-icon">✦</span><h2>Voto da plateia</h2><p>Um voto por dispositivo. Sem cadastro, direto ao ponto.</p><span className="text-link">Escolher favorito →</span></a>
        <a className="feature-card" href="/jurado/avaliar"><span className="feature-icon">◈</span><h2>Avaliação técnica</h2><p>Notas em cinco critérios, com liberdade para revisar antes de enviar.</p><span className="text-link">Acessar avaliação →</span></a>
        <a className="feature-card" href="/admin"><span className="feature-icon">⌘</span><h2>Painel do evento</h2><p>Gerencie participantes, jurados e acompanhe o resultado.</p><span className="text-link">Abrir painel →</span></a>
      </section>
    </>
  );
}

function PublicVote() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState<VotingStatus>('NOT_STARTED');
  const [hasVoted, setHasVoted] = useState(false);
  const [deviceToken, setDeviceToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = localStorage.getItem('halloween-device-token');
        const [state, candidateResponse, deviceResponse, registration] = await Promise.all([
          api<{ status: VotingStatus }>('/api/v1/public/state'),
          api<{ candidates: Candidate[] }>('/api/v1/public/candidates'),
          token ? api<{ hasVoted: boolean }>(`/api/v1/devices/${encodeURIComponent(token)}`) : Promise.resolve(null),
          token ? Promise.resolve(null) : api<{ deviceToken: string }>('/api/v1/devices/register', { method: 'POST' }),
        ]);
        const savedToken = token ?? registration?.deviceToken ?? '';
        if (registration) localStorage.setItem('halloween-device-token', savedToken);
        if (!active) return;
        setStatus(state.status);
        setCandidates(candidateResponse.candidates);
        setDeviceToken(savedToken);
        setHasVoted(deviceResponse?.hasVoted ?? false);
      } catch (loadError) {
        if (active) setError(formatError(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function vote(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return setError('Escolha uma fantasia antes de confirmar.');
    setSubmitting(true);
    setError('');
    try {
      await api('/api/v1/votes', {
        method: 'POST',
        body: JSON.stringify({ deviceToken, candidateId: selectedId }),
      });
      setHasVoted(true);
      setSuccess(true);
    } catch (voteError) {
      setError(formatError(voteError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-section narrow">
      <p className="eyebrow">VOTAÇÃO DA PLATEIA</p>
      <h1>Seu voto, <span>sua escolha.</span></h1>
      <p className="muted">Escolha uma fantasia para representar o Halloween 42sp.</p>
      {loading ? <p className="notice">Carregando a votação...</p> : error && !candidates.length ? <p className="alert">{error}</p> :
        success || hasVoted ? <div className="state-card success-card"><span className="state-symbol">✓</span><h2>Voto computado!</h2><p>Obrigado por participar. Seu dispositivo já registrou um voto.</p></div> :
        status !== 'OPEN' ? <div className="state-card"><span className="state-symbol">◷</span><h2>{statusLabels[status]}</h2><p>{status === 'NOT_STARTED' ? 'A votação ainda não foi liberada pela organização.' : 'Obrigado por fazer parte do concurso!'}</p></div> :
        candidates.length === 0 ? <div className="state-card"><h2>Inscrições em preparação</h2><p>Os candidatos aparecerão aqui quando forem cadastrados.</p></div> :
        <form className="vote-form" onSubmit={vote}>
          <div className="candidate-options">
            {candidates.map((candidate, index) => (
              <label className={`candidate-option ${selectedId === candidate.id ? 'selected' : ''}`} key={candidate.id}>
                <input type="radio" name="candidate" value={candidate.id} checked={selectedId === candidate.id} onChange={() => setSelectedId(candidate.id)} />
                <span className="candidate-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="candidate-copy"><strong>{candidate.costumeName}</strong><small>{candidate.studentName}</small></span>
                <span className="radio-indicator" aria-hidden="true" />
              </label>
            ))}
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="button button-primary full-width" disabled={submitting || !selectedId}>{submitting ? 'Registrando voto...' : 'Confirmar meu voto'}</button>
          <p className="fine-print">Cada dispositivo pode votar uma única vez.</p>
        </form>}
      {error && candidates.length > 0 && !success && !hasVoted && <p className="alert" role="alert">{error}</p>}
    </section>
  );
}

function JudgeEvaluation() {
  const [pin, setPin] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem('halloween-judge-token') ?? '');
  const [judgeName, setJudgeName] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [drafts, setDrafts] = useState<EvaluationDraft[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState(false);
  const [swapDirection, setSwapDirection] = useState<'forward' | 'backward'>('forward');
  const [swapPhase, setSwapPhase] = useState<'idle' | 'out' | 'in'>('idle');
  const swapTimer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);

  async function startSession(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api<{
        token: string;
        judge: { id: string; name: string };
        candidates: Candidate[];
        evaluations: Evaluation[];
      }>('/api/v1/judges/login', { method: 'POST', body: JSON.stringify({ pinCode: pin }) });
      sessionStorage.setItem('halloween-judge-token', data.token);
      sessionStorage.setItem('halloween-judge-id', data.judge.id);
      sessionStorage.setItem('halloween-judge-name', data.judge.name);
      setToken(data.token);
      setJudgeName(data.judge.name);
      setCandidates(data.candidates);
      setDrafts(data.candidates.map((candidate) => draftFromEvaluation(candidate.id, data.evaluations.find((evaluation) => evaluation.candidateId === candidate.id))));
    } catch (loginError) {
      setError(formatError(loginError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    let active = true;
    void api<{ judgeId: string; candidates: Candidate[]; evaluations: Evaluation[] }>('/api/v1/judges/evaluations', { headers: bearer(token) })
      .then((data) => {
        if (!active) return;
        setCandidates(data.candidates);
        setDrafts(data.candidates.map((candidate) => draftFromEvaluation(candidate.id, data.evaluations.find((evaluation) => evaluation.candidateId === candidate.id))));
        setJudgeName(sessionStorage.getItem('halloween-judge-name') ?? '');
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        if (loadError instanceof ApiError && (loadError.status === 401 || loadError.status === 409)) {
          sessionStorage.removeItem('halloween-judge-token');
          setToken('');
        }
        setError(formatError(loadError));
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => () => window.clearTimeout(swapTimer.current), []);

  function navigateTo(index: number) {
    if (index === current || swapPhase !== 'idle' || index < 0 || index >= candidates.length) return;
    setSwapDirection(index > current ? 'forward' : 'backward');
    setSwapPhase('out');
    swapTimer.current = window.setTimeout(() => {
      setCurrent(index);
      setSwapPhase('in');
      swapTimer.current = window.setTimeout(() => setSwapPhase('idle'), 220);
    }, 120);
  }

  function updateDraft(key: keyof EvaluationDraft, value: string) {
    const draft = drafts[current];
    if (!draft) return;
    const parsedValue = key === 'notes'
      ? value
      : value.trim() === ''
        ? Number.NaN
        : Number(value);
    setDrafts((currentDrafts) => currentDrafts.map((item) =>
      item.candidateId === draft.candidateId ? { ...item, [key]: parsedValue } : item,
    ));

    if (key !== 'notes') {
      const field = scoreFields.find((item) => item.key === key);
      const numberValue = typeof parsedValue === 'number' ? parsedValue : Number.NaN;
      const message = !Number.isFinite(numberValue)
        ? 'Informe uma nota válida.'
        : numberValue < 0 || numberValue > (field?.max ?? 0)
          ? `A nota deve ficar entre 0 e ${field?.max}.`
          : '';
      const errorKey = `${draft.candidateId}:${key}`;
      setFieldErrors((currentErrors) => {
        const nextErrors = { ...currentErrors };
        if (message) nextErrors[errorKey] = message;
        else delete nextErrors[errorKey];
        return nextErrors;
      });
    }
  }

  async function finalize() {
    const nextFieldErrors: Record<string, string> = {};
    let firstInvalidCandidate = -1;
    for (const [candidateIndex, candidateDraft] of drafts.entries()) {
      for (const field of scoreFields) {
        const value = candidateDraft[field.key];
        const message = !Number.isFinite(value)
          ? 'Informe uma nota válida.'
          : value < 0 || value > field.max
            ? `A nota deve ficar entre 0 e ${field.max}.`
            : '';
        if (message) {
          nextFieldErrors[`${candidateDraft.candidateId}:${field.key}`] = message;
          if (firstInvalidCandidate < 0) firstInvalidCandidate = candidateIndex;
        }
      }
    }
    setFieldErrors(nextFieldErrors);
    if (firstInvalidCandidate >= 0) {
      setError('');
      navigateTo(firstInvalidCandidate);
      return;
    }
    if (!window.confirm('Finalizar a avaliação? Depois do envio, as notas não poderão ser alteradas.')) return;
    setSubmitting(true);
    setError('');
    try {
      await api('/api/v1/judges/evaluations/finalize', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ judgeId: getJudgeIdFromSession(), evaluations: drafts }),
      });
      setCompleted(true);
      sessionStorage.removeItem('halloween-judge-token');
    } catch (submitError) {
      setError(formatError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return <section className="page-section narrow"><p className="eyebrow">AVALIAÇÃO ENVIADA</p><div className="state-card success-card"><span className="state-symbol">✓</span><h2>Obrigado, jurado!</h2><p>Sua avaliação foi finalizada e está bloqueada para edição.</p></div></section>;
  }

  if (!token || candidates.length === 0) {
    return (
      <section className="page-section narrow">
        <p className="eyebrow">ÁREA DO JURADO</p><h1>Avalie cada <span>detalhe.</span></h1>
        <p className="muted">Acesse com o PIN individual fornecido pela organização.</p>
        <form className="login-form" onSubmit={startSession}>
          <label htmlFor="judge-pin">PIN do jurado</label>
          <input id="judge-pin" autoComplete="one-time-code" value={pin} onChange={(event) => setPin(event.target.value.toUpperCase())} required maxLength={10} placeholder="Ex.: A1B2C3D4" />
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="button button-primary full-width" disabled={loading}>{loading ? 'Validando...' : 'Entrar para avaliar'}</button>
        </form>
      </section>
    );
  }

  const candidate = candidates[current];
  const draft = drafts[current];
  if (!candidate || !draft) return <p className="notice">Preparando avaliações...</p>;

  return (
    <section className="page-section">
      <div className="section-heading">
        <div><p className="eyebrow">FICHA DO JURADO{judgeName ? ` · ${judgeName.toUpperCase()}` : ''}</p><h1>Avaliação <span>técnica.</span></h1></div>
        <span className="step-counter">{String(current + 1).padStart(2, '0')} <span>/ {String(candidates.length).padStart(2, '0')}</span></span>
      </div>
      <nav className="candidate-stepper" aria-label="Navegar entre candidatos">
        {candidates.map((stepCandidate, index) => (
          <button
            aria-label={`Ir para candidato ${index + 1}: ${stepCandidate.studentName}`}
            aria-current={current === index ? 'step' : undefined}
            className={`candidate-step ${current === index ? 'active' : ''}`}
            disabled={swapPhase !== 'idle'}
            key={stepCandidate.id}
            onClick={() => navigateTo(index)}
            type="button"
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <span className="candidate-step-name">{stepCandidate.studentName}</span>
          </button>
        ))}
      </nav>
      <article className={`evaluation-card ${swapPhase === 'out' ? `swap-out-${swapDirection}` : ''} ${swapPhase === 'in' ? `swap-in-${swapDirection}` : ''}`}>
        <div className="candidate-intro"><span className="candidate-number">{String(current + 1).padStart(2, '0')}</span><div><p className="eyebrow">CANDIDATO {String(current + 1).padStart(2, '0')}</p><h2>{candidate.costumeName}</h2><p>{candidate.studentName}</p></div></div>
        <div className="score-list">
          {scoreFields.map(({ key, label, max }) => (
            <div className="score-field" key={key}>
              <label className="score-row" htmlFor={`score-${candidate.id}-${key}`}>
                <span>{label}<small>Máximo: {max} pontos</small></span>
                <span className="score-input"><input id={`score-${candidate.id}-${key}`} aria-invalid={Boolean(fieldErrors[`${candidate.id}:${key}`])} aria-describedby={fieldErrors[`${candidate.id}:${key}`] ? `error-${candidate.id}-${key}` : undefined} className={fieldErrors[`${candidate.id}:${key}`] ? 'invalid' : ''} type="number" min="0" max={max} step="0.01" value={Number.isFinite(draft[key]) ? draft[key] : ''} onChange={(event) => updateDraft(key, event.target.value)} /><small>/{max}</small></span>
              </label>
              {fieldErrors[`${candidate.id}:${key}`] && <p className="field-error" id={`error-${candidate.id}-${key}`} role="alert">{fieldErrors[`${candidate.id}:${key}`]}</p>}
            </div>
          ))}
        </div>
        <label className="notes-field">Observações <span>opcional</span><textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows={3} placeholder="Anotações sobre a apresentação..." /></label>
      </article>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="evaluation-actions">
        <button className="button button-outline" onClick={() => navigateTo(current - 1)} disabled={current === 0 || swapPhase !== 'idle'}>← Anterior</button>
        {current < candidates.length - 1
          ? <button className="button button-primary" onClick={() => navigateTo(current + 1)} disabled={swapPhase !== 'idle'}>Próximo candidato →</button>
          : <button className="button button-primary" onClick={finalize} disabled={submitting || swapPhase !== 'idle'}>{submitting ? 'Enviando...' : 'Finalizar avaliação'}</button>}
      </div>
      <p className="fine-print">Você pode navegar entre candidatos e revisar suas notas antes de finalizar.</p>
    </section>
  );
}

function getJudgeIdFromSession(): string {
  return sessionStorage.getItem('halloween-judge-id') ?? '';
}

function AdminPanel() {
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('halloween-admin-token') ?? '');
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [judges, setJudges] = useState<Array<{ id: string; name: string; status: string; pinCode: string | null }>>([]);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [summary, setSummary] = useState<{ votingStatus: VotingStatus; showQrCode: boolean; candidateCount: number; judgeCount: number; completedJudgeCount: number; voteCount: number } | null>(null);
  const [candidateForm, setCandidateForm] = useState({ intranetLogin: '', studentName: '', costumeName: '' });
  const [judgeName, setJudgeName] = useState('');
  const [newJudgePin, setNewJudgePin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refresh(token = adminToken) {
    const headers = bearer(token);
    const [summaryData, candidateData, judgeData] = await Promise.all([
      api<{ summary: NonNullable<typeof summary>; ranking: RankingRow[] }>('/api/v1/admin/summary', { headers }),
      api<{ candidates: Candidate[] }>('/api/v1/admin/candidates', { headers }),
      api<{ judges: Array<{ id: string; name: string; status: string; pinCode: string | null }> }>('/api/v1/admin/judges', { headers }),
    ]);
    setSummary(summaryData.summary);
    setRanking(summaryData.ranking);
    setCandidates(candidateData.candidates);
    setJudges(judgeData.judges);
  }

  useEffect(() => {
    if (!adminToken) return;
    let active = true;
    void refresh().catch((loadError: unknown) => {
      if (!active) return;
      setError(formatError(loadError));
      if (loadError instanceof ApiError && loadError.status === 401) {
        setAdminToken('');
        sessionStorage.removeItem('halloween-admin-token');
      }
    });
    return () => { active = false; };
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    const interval = window.setInterval(() => {
      void refresh().catch((refreshError: unknown) => setError(formatError(refreshError)));
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [adminToken]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>('/api/v1/admin/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      await refresh(token);
      sessionStorage.setItem('halloween-admin-token', token);
      setAdminToken(token);
    } catch (loginError) {
      setError(formatError(loginError));
    } finally {
      setLoading(false);
    }
  }

  async function perform(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(formatError(actionError));
    }
  }

  async function addCandidate(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await api('/api/v1/admin/candidates', { method: 'POST', headers: bearer(adminToken), body: JSON.stringify(candidateForm) });
      setCandidateForm({ intranetLogin: '', studentName: '', costumeName: '' });
    });
  }

  async function addJudge(event: FormEvent) {
    event.preventDefault();
    setNewJudgePin('');
    setError('');
    try {
      const data = await api<{ judge: { id: string; name: string; pinCode: string } }>('/api/v1/admin/judges', {
        method: 'POST',
        headers: bearer(adminToken),
        body: JSON.stringify({ name: judgeName }),
      });
      setNewJudgePin(data.judge.pinCode);
      setJudgeName('');
      await refresh();
    } catch (actionError) {
      setError(formatError(actionError));
    }
  }

  async function regenerateJudgePin(judge: { id: string; name: string }) {
    if (!window.confirm(`Gerar um novo PIN para ${judge.name}? O PIN atual será invalidado.`)) return;
    setError('');
    try {
      const data = await api<{ pinCode: string }>(`/api/v1/admin/judges/${judge.id}/pin`, {
        method: 'PATCH',
        headers: bearer(adminToken),
      });
      setNewJudgePin(data.pinCode);
      await refresh();
    } catch (actionError) {
      setError(formatError(actionError));
    }
  }

  async function changeVotingStatus(status: VotingStatus) {
    await perform(() => api('/api/v1/admin/voting-status', {
      method: 'PATCH',
      headers: bearer(adminToken),
      body: JSON.stringify({ status }),
    }));
  }

  async function changeQrCodeVisibility(visible: boolean) {
    await perform(() => api('/api/v1/admin/qr-code', {
      method: 'PATCH',
      headers: bearer(adminToken),
      body: JSON.stringify({ visible }),
    }));
  }

  if (!adminToken) {
    return <section className="page-section narrow"><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Painel do <span>evento.</span></h1><p className="muted">Entre com o usuário e a senha administrativos.</p>
      <form className="login-form" onSubmit={login}><label htmlFor="admin-username">Usuário</label><input id="admin-username" autoComplete="username" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /><label htmlFor="admin-password">Senha</label><input id="admin-password" type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required />{error && <p className="alert" role="alert">{error}</p>}<button className="button button-primary full-width" disabled={loading}>{loading ? 'Validando...' : 'Acessar painel'}</button></form>
    </section>;
  }

  return (
    <section className="page-section">
      <div className="section-heading"><div><p className="eyebrow">CONTROLE DO EVENTO</p><h1>Painel <span>admin.</span></h1></div><button className="button button-outline button-small" onClick={() => { sessionStorage.removeItem('halloween-admin-token'); setAdminToken(''); }}>Sair</button></div>
      {error && <p className="alert" role="alert">{error}</p>}
      {summary && <div className="stats-grid">
        <div className="stat-card"><span>STATUS DA VOTAÇÃO</span><strong className={`status-pill ${summary.votingStatus.toLowerCase()}`}>{statusLabels[summary.votingStatus]}</strong></div>
        <div className="stat-card"><span>VOTOS DA PLATEIA</span><strong>{summary.voteCount}</strong></div>
        <div className="stat-card"><span>CANDIDATOS</span><strong>{summary.candidateCount}</strong></div>
        <div className="stat-card"><span>JURADOS FINALIZADOS</span><strong>{summary.completedJudgeCount} / {summary.judgeCount}</strong></div>
      </div>}
      <div className="admin-grid">
        <article className="admin-card">
          <div className="card-heading"><div><p className="eyebrow">VOTAÇÃO</p><h2>Controle da sessão</h2></div></div>
          <div className="status-controls">
            {(['NOT_STARTED', 'OPEN', 'CLOSED'] as VotingStatus[]).map((status) => <button key={status} className={`status-button ${summary?.votingStatus === status ? 'active' : ''}`} onClick={() => changeVotingStatus(status)}>{statusLabels[status]}</button>)}
          </div>
          <div className="qr-admin-control">
            <div><strong>QR Code na página inicial</strong><small>{summary?.showQrCode ? 'Visível para todos que acessarem o site.' : 'Oculto da página inicial.'}</small></div>
            <button className={`status-button ${summary?.showQrCode ? 'active' : ''}`} onClick={() => changeQrCodeVisibility(!summary?.showQrCode)} disabled={!summary}>{summary?.showQrCode ? 'Ocultar QR Code' : 'Mostrar QR Code'}</button>
          </div>
        </article>
        <article className="admin-card">
          <div className="card-heading"><div><p className="eyebrow">CADASTRO</p><h2>Novo candidato</h2></div></div>
          <form className="stack-form" onSubmit={addCandidate}>
            <input aria-label="Login da Intranet" placeholder="Login da Intranet" value={candidateForm.intranetLogin} onChange={(event) => setCandidateForm({ ...candidateForm, intranetLogin: event.target.value })} required maxLength={50} />
            <input aria-label="Nome do participante" placeholder="Nome do participante" value={candidateForm.studentName} onChange={(event) => setCandidateForm({ ...candidateForm, studentName: event.target.value })} required maxLength={100} />
            <input aria-label="Nome da fantasia" placeholder="Nome da fantasia" value={candidateForm.costumeName} onChange={(event) => setCandidateForm({ ...candidateForm, costumeName: event.target.value })} required maxLength={100} />
            <button className="button button-primary">Adicionar candidato</button>
          </form>
        </article>
        <article className="admin-card">
          <div className="card-heading"><div><p className="eyebrow">ACESSO DA BANCA</p><h2>Novo jurado</h2></div></div>
          <form className="stack-form" onSubmit={addJudge}><input aria-label="Nome do jurado" placeholder="Nome do jurado" value={judgeName} onChange={(event) => setJudgeName(event.target.value)} required maxLength={100} /><button className="button button-primary">Gerar PIN</button></form>
          {newJudgePin && <div className="pin-reveal" role="status"><span>PIN gerado ou renovado — compartilhe com o jurado</span><strong>{newJudgePin}</strong></div>}
        </article>
        <article className="admin-card ranking-card">
          <div className="card-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Ranking atual</h2></div><button className="button button-outline button-small" onClick={() => void perform(async () => {})}>Atualizar</button></div>
          {ranking.length === 0 ? <p className="muted">Cadastre candidatos para ver o ranking.</p> : <div className="table-wrap"><table><thead><tr><th>#</th><th>Fantasia</th><th>Júri</th><th>Votos</th><th>Ações</th></tr></thead><tbody>{ranking.map((row, index) => <tr key={row.candidateId}><td className="rank-cell">{String(index + 1).padStart(2, '0')}</td><td><strong>{row.costumeName}</strong><small>{row.studentName}</small></td><td>{row.juryAverage.toFixed(2)}</td><td>{row.publicVotesCount}</td><td className="actions-cell"><button className="icon-button" aria-label={`Editar ${row.costumeName}`} onClick={() => { const candidate = candidates.find((entry) => entry.id === row.candidateId); if (!candidate) return; const studentName = window.prompt('Nome do participante', candidate.studentName); if (studentName === null) return; const costumeName = window.prompt('Nome da fantasia', candidate.costumeName); if (costumeName === null) return; const intranetLogin = window.prompt('Login da Intranet', candidate.intranetLogin); if (intranetLogin === null) return; void perform(() => api(`/api/v1/admin/candidates/${row.candidateId}`, { method: 'PATCH', headers: bearer(adminToken), body: JSON.stringify({ intranetLogin, studentName, costumeName }) })); }}>✎</button><button className="icon-button" aria-label={`Excluir ${row.costumeName}`} onClick={() => { if (window.confirm(`Excluir ${row.costumeName}? Os votos e notas associados também serão removidos.`)) void perform(() => api(`/api/v1/admin/candidates/${row.candidateId}`, { method: 'DELETE', headers: bearer(adminToken) })); }}>×</button></td></tr>)}</tbody></table></div>}
        </article>
        <article className="admin-card">
          <div className="card-heading"><div><p className="eyebrow">EQUIPE</p><h2>Jurados cadastrados</h2></div></div>
          {judges.length === 0 ? <p className="muted">Nenhum jurado cadastrado.</p> : <ul className="judge-list">{judges.map((judge) => <li key={judge.id}><span className="judge-details"><strong>{judge.name}</strong><span className="judge-pin">{judge.pinCode ? `PIN: ${judge.pinCode}` : 'PIN antigo não disponível'}</span><small>{judge.status === 'COMPLETED' ? 'Avaliação finalizada' : 'Avaliação pendente'}</small></span><span className="judge-actions">{judge.status !== 'COMPLETED' && <button className="button button-outline button-small" onClick={() => void regenerateJudgePin(judge)}>Novo PIN</button>}<button className="icon-button" aria-label={`Excluir jurado ${judge.name}`} onClick={() => { if (window.confirm(`Excluir o jurado ${judge.name} e suas avaliações?`)) void perform(() => api(`/api/v1/admin/judges/${judge.id}`, { method: 'DELETE', headers: bearer(adminToken) })); }}>×</button></span></li>)}</ul>}
        </article>
      </div>
      <p className="fine-print">O ranking segue: média dos jurados, votos da plateia, criatividade e execução.</p>
    </section>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (
    <div className="app-shell">
      <BrandHeader />
      <main>{path === '/votar' ? <PublicVote /> : path === '/jurado/avaliar' ? <JudgeEvaluation /> : path === '/admin' ? <AdminPanel /> : <Home />}</main>
      <footer className="footer"><span>42sp HALLOWEEN VOTING</span><span>FEITO PARA UMA NOITE ASSUSTADORAMENTE BOA.</span></footer>
    </div>
  );
}

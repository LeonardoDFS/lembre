import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { HighlightedText } from './HighlightText';

export type StudyItem = {
  unitId: string; cardId: string; deckId: string; deckName: string; languageName: string;
  direction: 'forward' | 'reverse'; isNew: boolean; prompt: string; answer: string; example: string; notes: string; hasAudio: boolean; intervals?: string[];
};
export type Queue = { dueCount: number; newCount: number; items: StudyItem[] };
type Props = { deckId: string | null; practice: boolean; onBack: () => void; onChanged: () => Promise<void> };
const ratings = [
  { value: 1, label: 'Errei', className: 'again' },
  { value: 2, label: 'Difícil', className: 'hard' },
  { value: 3, label: 'Bom', className: 'good' },
  { value: 4, label: 'Fácil', className: 'easy' }
];

export default function StudyPage({ deckId, practice, onBack, onChanged }: Props) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [practiceReviewed, setPracticeReviewed] = useState(0);
  const [startedAt] = useState(Date.now());
  const cardStartedAt = useRef(Date.now());
  const [finished, setFinished] = useState(false);
  const path = (practice ? '/study/practice' : '/study/queue') + (deckId ? '?deckId=' + encodeURIComponent(deckId) : '');

  async function refresh() {
    const next = await api<Queue>(path);
    setQueue(next);
    if (next.items.length === 0 && (practiceReviewed + counts.reduce((a, b) => a + b, 0)) > 0) setFinished(true);
  }
  useEffect(() => { refresh().catch((cause) => setError(cause.message)); }, [deckId, practice]);

  function advancePractice() {
    if (!practice || !revealed || !queue) return;
    const remaining = queue.items.slice(1);
    setQueue({ ...queue, items: remaining });
    setPracticeReviewed((count) => count + 1);
    setRevealed(false);
    cardStartedAt.current = Date.now();
    if (!remaining.length) setFinished(true);
  }

  async function rate(value: number) {
    const item = queue?.items[0];
    if (!item || busy || !revealed || practice) return;
    setBusy(true); setError('');
    try {
      await api('/study/' + item.unitId + '/rate', 'POST', { rating: value, elapsedMs: Date.now() - cardStartedAt.current });
      setCounts((old) => old.map((count, index) => index === value - 1 ? count + 1 : count));
      setRevealed(false);
      const next = await api<Queue>(path);
      setQueue(next);
      cardStartedAt.current = Date.now();
      if (next.items.length === 0) setFinished(true);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a revisão.');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); if (!revealed) setRevealed(true); else if (practice) advancePractice(); }
      if (!practice && revealed && ['1', '2', '3', '4'].includes(event.key)) rate(Number(event.key));
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [revealed, queue, busy, practice]);

  const item = queue?.items[0];
  const reviewed = practice ? practiceReviewed : counts.reduce((a, b) => a + b, 0);
  if (finished) return <div className="study-wrap summary-wrap">
    <div className="summary-check">✓</div><div className="eyebrow">{practice ? 'TREINO CONCLUÍDO' : 'SESSÃO CONCLUÍDA'}</div><h1>Boa revisão!</h1>
    <p className="intro">Você {practice ? 'praticou' : 'revisou'} {reviewed} {reviewed === 1 ? 'cartão' : 'cartões'} nesta sessão.</p>
    <div className="summary-grid"><div><strong>{reviewed}</strong><span>{practice ? 'Praticados' : 'Revisados'}</span></div><div><strong>{Math.max(1, Math.ceil((Date.now() - startedAt) / 60000))} min</strong><span>Tempo aproximado</span></div></div>
    {!practice && <div className="rating-summary">{ratings.map((rating, index) => <span key={rating.value}>{rating.label}: <strong>{counts[index]}</strong></span>)}</div>}
    {practice && <p className="intro">O treino livre não altera o intervalo das próximas revisões.</p>}
    <button className="primary" onClick={onBack}>Voltar ao início</button>
  </div>;
  if (!queue && !error) return <div className="center-screen">Preparando revisão...</div>;
  if (!item) return <div className="study-wrap empty-study"><div className="eyebrow">{practice ? 'TREINO LIVRE' : 'REVISÃO EM DIA'}</div><h1>{practice ? 'Nenhum cartão estudado ainda.' : 'Nada pendente agora.'}</h1>
    <p className="intro">{practice ? 'Estude um cartão na revisão normal para incluí-lo no treino livre.' : 'Quando um cartão estiver pronto para revisão, ele aparecerá aqui.'}</p>
    {error && <div className="error" role="alert">{error}</div>}<button className="primary" onClick={onBack}>Voltar ao início</button></div>;
  return <div className="study-wrap">
    {practice && <p className="practice-note">Treino livre · ordem aleatória · sem alterar o agendamento</p>}
    <div className="study-header"><button className="text-button" onClick={onBack}>✕ Encerrar sessão</button><span>{item.deckName}</span><span>{reviewed + 1} de {reviewed + queue.items.length}</span></div>
    <div className="study-progress"><div style={{ width: (reviewed / (reviewed + queue.items.length) * 100) + '%' }} /></div>
    <div className="study-card"><div className="study-label">{item.languageName} · {item.isNew ? 'NOVO' : 'REVISÃO'} · {item.direction === 'reverse' ? 'RESPOSTA → PERGUNTA' : 'PERGUNTA → RESPOSTA'}</div>
      <h1><HighlightedText text={item.prompt} /></h1>
      {item.hasAudio && <audio controls preload="none" src={'/api/cards/' + item.cardId + '/audio'} aria-label="Áudio do cartão" />}
      {revealed && <div className="study-answer"><span>RESPOSTA</span><h2><HighlightedText text={item.answer} /></h2>
        {item.example && <p className="example">“<HighlightedText text={item.example} />”</p>}{item.notes && <p className="study-notes">{item.notes}</p>}</div>}
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {!revealed ? <button className="primary reveal-button" onClick={() => setRevealed(true)}>Mostrar resposta <kbd>Espaço</kbd></button>
      : practice ? <button className="primary reveal-button" onClick={advancePractice}>Próximo cartão <kbd>Espaço</kbd></button>
      : <div className="rate-area"><div className="rate-caption">Como você se lembrou?</div><div className="rate-grid">{ratings.map((rating) => <button key={rating.value} className={'rate-button ' + rating.className} disabled={busy} onClick={() => rate(rating.value)}><span>{rating.label}<kbd>{rating.value}</kbd></span><small>{item.intervals?.[rating.value - 1] ?? ''}</small></button>)}</div></div>}
  </div>;
}


import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { HighlightField, HighlightedText } from './HighlightText';

export type Deck = { id: string; name: string; description: string; languageId: string; languageName: string; cardCount: number };
type Card = { id: string; deckId: string; prompt: string; answer: string; example: string; notes: string; tags: string[]; directions: 'forward' | 'reverse' | 'both'; hasAudio: boolean };
type Props = { deck: Deck; onBack: () => void; onChanged: () => Promise<void> };

export default function CardsPage({ deck, onBack, onChanged }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [example, setExample] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [directions, setDirections] = useState<Card['directions']>('forward');

  async function refresh() {
    setCards(await api<Card[]>('/cards?deckId=' + encodeURIComponent(deck.id)));
  }
  useEffect(() => { refresh().catch((cause) => setError(cause.message)); }, [deck.id]);

  function open(card: Card | 'new') {
    setEditing(card);
    setPrompt(card === 'new' ? '' : card.prompt);
    setAnswer(card === 'new' ? '' : card.answer);
    setExample(card === 'new' ? '' : card.example);
    setNotes(card === 'new' ? '' : card.notes);
    setTags(card === 'new' ? '' : card.tags.join(', '));
    setAudioFile(null);
    setDirections(card === 'new' ? 'forward' : card.directions);
    setError('');
  }
  async function save(event: FormEvent, another = false) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError('');
    try {
      const payload = { deckId: deck.id, prompt, answer, example, notes,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), directions };
      const saved = await api<{ id: string }>(editing === 'new' ? '/cards' : '/cards/' + editing.id, editing === 'new' ? 'POST' : 'PATCH', payload);
      if (audioFile) {
        if (audioFile.size > 5 * 1024 * 1024) throw new Error('O áudio deve ter até 5 MB.');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('Não foi possível ler o áudio.'));
          reader.readAsDataURL(audioFile);
        });
        try {
          await api('/cards/' + saved.id + '/audio', 'POST', { name: audioFile.name, data });
        } catch (cause) {
          if (editing === 'new') setEditing({ id: saved.id, deckId: deck.id, prompt, answer, example, notes,
            tags: payload.tags, directions, hasAudio: false });
          throw cause;
        }
      }
      setAudioFile(null);
      await refresh();
      await onChanged();
      if (another && editing === 'new') {
        setPrompt(''); setAnswer(''); setExample(''); setNotes(''); setTags(''); setAudioFile(null);
      } else setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  async function removeAudio(card: Card) {
    if (!window.confirm('Remover o áudio deste cartão?')) return;
    setError('');
    try {
      await api('/cards/' + card.id + '/audio', 'DELETE');
      setEditing({ ...card, hasAudio: false });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover o áudio.'); }
  }
  async function remove(card: Card) {
    if (!window.confirm(`Excluir o cartão “${card.prompt}” e seu histórico de revisão?`)) return;
    setError('');
    try {
      await api('/cards/' + card.id, 'DELETE');
      await refresh(); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir.'); }
  }
  async function reset(card: Card) {
    const direction = card.directions === 'both'
      ? window.prompt('Qual sentido reiniciar? Digite "frente", "verso" ou "ambos".', 'ambos')
      : 'ambos';
    if (direction === null) return;
    const chosen = direction === 'frente' ? 'forward' : direction === 'verso' ? 'reverse' : direction === 'ambos' ? 'all' : null;
    if (!chosen) { setError('Escolha frente, verso ou ambos.'); return; }
    if (!window.confirm('Reiniciar o progresso desse cartão? As avaliações anteriores do sentido escolhido serão apagadas.')) return;
    setError('');
    try {
      await api('/cards/' + card.id + '/reset', 'POST', { direction: chosen });
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reiniciar.'); }
  }

  const visibleCards = cards.filter((card) => (card.prompt + ' ' + card.answer + ' ' + card.example + ' ' + card.tags.join(' ')).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <>
    <button className="text-button back-link" onClick={onBack}>← Meus baralhos</button>
    <div className="eyebrow">{deck.languageName.toUpperCase()} · BARALHO</div>
    <div className="page-title"><div><h1>{deck.name}</h1><p className="intro">{cards.length} {cards.length === 1 ? 'cartão' : 'cartões'} neste baralho</p></div>
      <button className="primary" onClick={() => open('new')}>+ Criar cartão</button></div>
    {error && !editing && <div className="error" role="alert">{error}</div>}
    {cards.length > 0 && <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cartão, resposta ou tag..." aria-label="Buscar cartões" />}
    {visibleCards.length ? <div className="card-list">{visibleCards.map((card) => <article className="card-row" key={card.id}>
      <div className="card-row-main"><span className="pill">{card.directions === 'both' ? 'Dois sentidos' : card.directions === 'reverse' ? 'Verso → frente' : 'Frente → verso'}</span>
        <h2><HighlightedText text={card.prompt} /></h2><p><HighlightedText text={card.answer} /></p>{card.example && <small>Exemplo: <HighlightedText text={card.example} /></small>}{!!card.hasAudio && <audio controls preload="none" src={'/api/cards/' + card.id + '/audio'} aria-label={'Áudio de ' + card.prompt} />}</div>
      <div className="card-row-actions"><button className="ghost small" onClick={() => open(card)}>Editar</button>
        <button className="ghost small" onClick={() => reset(card)}>Reiniciar</button>
        <button className="danger-text" onClick={() => remove(card)}>Excluir</button></div>
    </article>)}</div>
      : <div className="empty empty-action">{cards.length ? <p>Nenhum cartão corresponde à busca.</p> : <><h2>Este baralho ainda está vazio.</h2><p>Crie seu primeiro cartão para começar a estudar.</p><button className="primary" onClick={() => open('new')}>Criar primeiro cartão</button></>}</div>}

    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <form className="modal card-modal" onSubmit={(event) => save(event)}>
        <div className="modal-head"><div className="eyebrow">{deck.name.toUpperCase()}</div><button type="button" className="close" onClick={() => setEditing(null)} aria-label="Fechar">×</button></div>
        <h2>{editing === 'new' ? 'Criar cartão' : 'Editar cartão'}</h2>
        <HighlightField label="Pergunta ou termo" autoFocus required rows={2} maxLength={1000} value={prompt} onChange={setPrompt} placeholder="Ex.: To circle back" />
        <HighlightField label="Resposta ou significado" required rows={2} maxLength={1000} value={answer} onChange={setAnswer} placeholder="Ex.: Retomar um assunto" />
        <HighlightField label="Frase de exemplo (opcional)" rows={2} maxLength={2000} value={example} onChange={setExample} />
        <div className="audio-field"><label htmlFor="card-audio">Áudio do cartão <span className="optional">opcional · MP3, WAV, OGG, M4A ou WebM, até 5 MB</span></label>
          <input id="card-audio" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,.mp3,.wav,.ogg,.m4a,.webm"
            onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} />
          {audioFile && <small>Selecionado: {audioFile.name}</small>}
          {editing !== 'new' && editing.hasAudio && <div className="audio-current"><audio controls preload="none" src={'/api/cards/' + editing.id + '/audio'} />
            <button type="button" className="danger-text" onClick={() => removeAudio(editing)}>Remover áudio</button></div>}
        </div>
        <label>Observação <span className="optional">opcional</span><textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>Tags <span className="optional">separe por vírgula</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Ex.: trabalho, expressão" /></label>
        {editing === 'new' ? <label>Sentido da revisão<select value={directions} onChange={(event) => setDirections(event.target.value as Card['directions'])}>
          <option value="forward">Pergunta → resposta</option><option value="reverse">Resposta → pergunta</option><option value="both">Dois sentidos independentes</option>
        </select></label> : <p className="form-note">O sentido de revisão deste cartão permanece o mesmo ao editar.</p>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
          {editing === 'new' && <button type="button" className="ghost" disabled={busy || !prompt.trim() || !answer.trim()} onClick={(event) => save(event as unknown as FormEvent, true)}>Salvar e criar outro</button>}
          <button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar cartão'}</button></div>
      </form>
    </div>}
  </>;
}


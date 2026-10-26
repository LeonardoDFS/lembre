import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { api } from './api';
import { HighlightedText } from './HighlightText';

type ImportRow = {
  key: string;
  prompt: string;
  answer: string;
  audioFile: File | null;
  cardId?: string;
  audioSaved: boolean;
};
type Props = { deckId: string; deckName: string; onClose: () => void; onImported: () => Promise<void> };

const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.webm'];
function isAudio(file: File): boolean {
  const lower = file.name.toLocaleLowerCase('en-US');
  return file.type.startsWith('audio/') || audioExtensions.some((extension) => lower.endsWith(extension));
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Não foi possível ler o áudio ' + file.name + '.'));
    reader.readAsDataURL(file);
  });
}
function rowKey(index: number): string { return Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2, 8); }

function AudioPreview({ file, index }: { file: File; index: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? <audio className="batch-audio-player" controls preload="none" src={url} aria-label={'Prévia do áudio do cartão ' + (index + 1)} /> : null;
}

export default function BatchImport({ deckId, deckName, onClose, onImported }: Props) {
  const [rawText, setRawText] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const validRows = useMemo(() => rows.length > 0 && rows.every((row) => row.prompt.trim() && row.answer.trim()), [rows]);
  const hasSavedCards = rows.some((row) => row.cardId);

  function parseText() {
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) { setError('Cole pelo menos uma pergunta e uma resposta, cada uma em sua linha.'); return; }
    if (lines.length % 2 !== 0) { setError('Há uma linha sem par. Confira se cada linha em inglês é seguida pela tradução.'); return; }
    setRows(Array.from({ length: lines.length / 2 }, (_, index) => ({
      key: rowKey(index), prompt: lines[index * 2], answer: lines[index * 2 + 1], audioFile: null, audioSaved: false
    })));
    setError('');
    setProgress('');
  }

  function updateRow(key: string, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function setAudio(key: string, file: File | null) {
    if (file && !isAudio(file)) { setError('Use MP3, WAV, OGG, M4A ou WebM.'); return; }
    if (file && file.size > 5 * 1024 * 1024) { setError('Cada áudio deve ter até 5 MB.'); return; }
    updateRow(key, { audioFile: file, audioSaved: false });
    setError('');
  }

  function addAudioFiles(filesLike: FileList | File[], startIndex?: number) {
    const files = Array.from(filesLike);
    if (!files.length) return;
    const unsupported = files.find((file) => !isAudio(file));
    if (unsupported) { setError('“' + unsupported.name + '” não parece ser um áudio MP3, WAV, OGG, M4A ou WebM.'); return; }
    const tooLarge = files.find((file) => file.size > 5 * 1024 * 1024);
    if (tooLarge) { setError('“' + tooLarge.name + '” passa do limite de 5 MB por áudio.'); return; }

    const numbered = files.map((file) => {
      const match = file.name.match(/^(\d+)(?:[ ._-]|$)/);
      return { file, number: match ? Number(match[1]) : -1 };
    });
    let assignments: Array<{ file: File; index: number }>;
    if (startIndex !== undefined) {
      assignments = [{ file: files[0], index: startIndex }];
    } else if (numbered.every((entry) => entry.number > 0)) {
      const numbers = numbered.map((entry) => entry.number);
      if (new Set(numbers).size !== numbers.length) { setError('Dois áudios têm o mesmo número no nome. Use números únicos para cada cartão.'); return; }
      const firstNumber = Math.min(...numbers);
      const lastNumber = Math.max(...numbers);
      // Continuações de textos anteriores podem começar em 24, 35 etc.
      const offset = lastNumber > rows.length ? firstNumber : 1;
      assignments = numbered.map(({ file, number }) => ({ file, index: number - offset }));
    } else if (files.length === rows.length) {
      assignments = files
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }))
        .map((file, index) => ({ file, index }));
    } else {
      setError('Para associar vários áudios automaticamente, nomeie-os com a posição do cartão (01.mp3, 02.mp3...). Você também pode soltá-los diretamente no cartão correspondente.');
      return;
    }
    if (assignments.some((entry) => entry.index < 0 || entry.index >= rows.length)) {
      setError('O número de um arquivo não corresponde a um cartão desta prévia.'); return;
    }
    setRows((current) => current.map((row, index) => {
      const assignment = assignments.find((entry) => entry.index === index);
      return assignment ? { ...row, audioFile: assignment.file, audioSaved: false } : row;
    }));
    setError('');
  }

  function handleAudioDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addAudioFiles(event.dataTransfer.files);
  }

  async function importCards() {
    if (!validRows || busy) return;
    setBusy(true); setError(''); setProgress('Preparando importação...');
    try {
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        setProgress(`Salvando cartão ${index + 1} de ${rows.length}...`);
        const payload = { deckId, prompt: row.prompt.trim(), answer: row.answer.trim(), example: '', notes: '', tags: [], directions: 'forward' };
        const saved = row.cardId
          ? await api<{ id: string }>('/cards/' + row.cardId, 'PATCH', payload)
          : await api<{ id: string }>('/cards', 'POST', payload);
        if (!row.cardId) {
          updateRow(row.key, { cardId: saved.id });
          row.cardId = saved.id;
        }
        if (row.audioFile && !row.audioSaved) {
          setProgress(`Salvando áudio do cartão ${index + 1} de ${rows.length}...`);
          const data = await fileToBase64(row.audioFile);
          await api('/cards/' + saved.id + '/audio', 'POST', { name: row.audioFile.name, data });
          updateRow(row.key, { audioSaved: true });
          row.audioSaved = true;
        }
      }
      await onImported();
      onClose();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : 'Não foi possível concluir a importação.') + ' Os cartões já salvos estão marcados; clique novamente para continuar sem duplicá-los.');
      setProgress('Importação parcial. Revise o cartão indicado e tente novamente.');
    } finally { setBusy(false); }
  }

  return <div className="modal-backdrop batch-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !hasSavedCards) onClose(); }}>
    <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-title">
      <div className="modal-head"><div className="eyebrow">{deckName.toUpperCase()}</div><button type="button" className="close" onClick={onClose} disabled={busy || hasSavedCards} aria-label="Fechar">×</button></div>
      <h2 id="batch-title">Importar cartões em lote</h2>
      <p className="batch-help">Cole as linhas alternando inglês e português. Linhas vazias são ignoradas; destaques com <code>==assim==</code> são preservados.</p>
      {rows.length === 0 ? <>
        <label className="batch-label">Texto linha a linha<textarea className="batch-source" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'She looked up at the sky.\nEla olhou para o céu.\n\nHe smiled.\nEle sorriu.'} autoFocus /></label>
        <div className="batch-actions"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button type="button" className="primary" onClick={parseText}>Gerar prévia</button></div>
      </> : <>
        <div className="batch-summary"><strong>{rows.length} {rows.length === 1 ? 'cartão' : 'cartões'}</strong><span>· perguntas na frente, traduções no verso</span><button type="button" className="text-button" onClick={() => { if (!busy && !rows.some((row) => row.cardId)) { setRows([]); setError(''); setProgress(''); } }} disabled={busy || rows.some((row) => row.cardId)}>Editar texto</button></div>
        <div className="batch-audio-drop" onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={handleAudioDrop} data-dragging={dragging}>
          <strong>Solte áudios aqui para anexá-los</strong><span>Solte a sequência numerada desta aula, por exemplo 01–10 ou 24–33. Confira o áudio de cada cartão antes de importar.</span>
        </div>
        <div className="batch-preview-list">{rows.map((row, index) => <article className="batch-preview-card" key={row.key}>
          <div className="batch-card-heading"><span>Cartão {String(index + 1).padStart(2, '0')}</span>{row.cardId && <span className="batch-saved">Salvo</span>}</div>
          <label>Pergunta<textarea rows={2} maxLength={1000} value={row.prompt} disabled={busy} onChange={(event) => updateRow(row.key, { prompt: event.target.value })} /></label>
          <label>Resposta<textarea rows={2} maxLength={1000} value={row.answer} disabled={busy} onChange={(event) => updateRow(row.key, { answer: event.target.value })} /></label>
          <div className="batch-audio-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addAudioFiles(event.dataTransfer.files, index); }}>
            <input ref={(element) => { inputRefs.current[row.key] = element; }} className="visually-hidden" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,.mp3,.wav,.ogg,.m4a,.webm" disabled={busy} onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file) setAudio(row.key, file); event.target.value = ''; }} />
            <span className="batch-audio-icon">♪</span><span className="batch-audio-name">{row.audioFile ? <><strong>{row.audioFile.name}</strong><small>{row.audioSaved ? 'Áudio vinculado a este cartão' : 'Áudio deste cartão, até 5 MB'}</small></> : <><strong>Áudio individual (opcional)</strong><small>Arraste para cá ou escolha um arquivo</small></>}</span>
            <button type="button" className="ghost small" disabled={busy} onClick={() => inputRefs.current[row.key]?.click()}>{row.audioFile ? 'Trocar' : 'Escolher'}</button>
            {row.audioFile && !row.audioSaved && <button type="button" className="danger-text" disabled={busy} aria-label="Remover áudio da prévia" onClick={() => setAudio(row.key, null)}>×</button>}
          </div>
          {row.audioFile && <><small className="batch-audio-associated">Este áudio ficará vinculado somente a este cartão.</small><AudioPreview file={row.audioFile} index={index} /></>}
          <div className="batch-rendered"><HighlightedText text={row.prompt} /> <span>→</span> <HighlightedText text={row.answer} /></div>
        </article>)}</div>
        {progress && <p className="batch-progress" aria-live="polite">{progress}</p>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="batch-actions"><button type="button" className="ghost" onClick={onClose} disabled={busy || hasSavedCards}>Cancelar</button><button type="button" className="primary" onClick={importCards} disabled={busy || !validRows}>{busy ? 'Importando...' : 'Importar ' + rows.length + ' cartões'}</button></div>
      </>}
      {error && rows.length === 0 && <div className="error" role="alert">{error}</div>}
    </section>
  </div>;
}

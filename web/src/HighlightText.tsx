import { useRef, type Dispatch, type SetStateAction } from 'react';

export function HighlightedText({ text }: { text: string }) {
  return <>{text.split(/(==[^=]+==|\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('==') && part.endsWith('==')
      ? <mark key={index}>{part.slice(2, -2)}</mark>
      : part.startsWith('**') && part.endsWith('**')
        ? <strong key={index}>{part.slice(2, -2)}</strong> : part
  )}</>;
}

type Props = {
  label: string; value: string; onChange: Dispatch<SetStateAction<string>>;
  maxLength: number; rows: number; required?: boolean; autoFocus?: boolean; placeholder?: string;
};
export function HighlightField({ label, value, onChange, maxLength, rows, required, autoFocus, placeholder }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  function format(wrapper: '==' | '**') {
    const input = textarea.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end } = input;
    if (start === end) { input.focus(); return; }
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + wrapper + selected + wrapper + value.slice(end);
    if (next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + 2, end + 2);
    });
  }
  return <div className="highlight-field">
    <div className="highlight-head"><label htmlFor={'field-' + label}>{label}</label>
      <div className="highlight-actions"><button type="button" className="highlight-button" title="Selecione um trecho e clique para grifar" onMouseDown={(event) => event.preventDefault()} onClick={() => format('==')}>Grifar</button>
      <button type="button" className="highlight-button" title="Selecione um trecho e clique para colocar em negrito" onMouseDown={(event) => event.preventDefault()} onClick={() => format('**')}><strong>Negrito</strong></button></div></div>
    <textarea ref={textarea} id={'field-' + label} rows={rows} maxLength={maxLength} required={required}
      autoFocus={autoFocus} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    {(value.includes('==') || value.includes('**')) && <div className="highlight-preview"><span>Prévia</span><p><HighlightedText text={value} /></p></div>}
  </div>;
}


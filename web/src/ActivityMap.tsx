type Day = { day: string; count: number };
export type Activity = { today: string; days: Day[] };

function dateAt(day: string): Date { return new Date(day + 'T12:00:00Z'); }
function dayKey(date: Date): string { return date.toISOString().slice(0, 10); }
const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function ActivityMap({ activity }: { activity: Activity }) {
  if (!activity.today) return null;
  const end = dateAt(activity.today);
  const first = dateAt(activity.today);
  first.setUTCDate(first.getUTCDate() - 364);
  const aligned = new Date(first);
  aligned.setUTCDate(aligned.getUTCDate() - aligned.getUTCDay());
  const counts = new Map(activity.days.map((item) => [item.day, item.count]));
  const cells: { key: string; count: number; visible: boolean; date: Date }[] = [];
  for (const cursor = new Date(aligned); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    const key = dayKey(date);
    cells.push({ key, date, count: counts.get(key) ?? 0, visible: date >= first });
  }
  const weeks = Math.ceil(cells.length / 7);
  const labels = Array.from({ length: weeks }, (_, index) => {
    const date = cells[index * 7]?.date;
    if (!date) return '';
    const previous = index ? cells[(index - 1) * 7]?.date : null;
    return index === 0 || date.getUTCMonth() !== previous?.getUTCMonth() ? month.format(date) : '';
  });
  const activeDays = cells.filter((cell) => cell.visible && cell.count > 0).length;
  return <section className="activity-card" aria-label="Mapa de atividades dos últimos 365 dias">
    <div className="activity-heading"><div><h2>Seu ritmo de estudo</h2><p>{activeDays} {activeDays === 1 ? 'dia com revisão' : 'dias com revisão'} nos últimos 365 dias</p></div><span>Últimos 12 meses</span></div>
    <div className="activity-scroll"><div className="activity-inner" style={{ width: weeks * 16 }}>
      <div className="activity-months">{labels.map((label, index) => <span key={index}>{label}</span>)}</div>
      <div className="activity-grid">{Array.from({ length: weeks * 7 }, (_, index) => {
        const cell = cells[index];
        if (!cell || !cell.visible) return <span className="activity-cell empty-cell" key={index} aria-hidden="true" />;
        const level = cell.count === 0 ? 0 : cell.count < 3 ? 1 : cell.count < 6 ? 2 : cell.count < 11 ? 3 : 4;
        const label = fullDate.format(cell.date) + ': ' + cell.count + (cell.count === 1 ? ' revisão' : ' revisões');
        return <span className={'activity-cell level-' + level} key={cell.key} title={label} aria-label={label} />;
      })}</div>
    </div></div>
    <div className="activity-legend"><span>Menos</span>{[0,1,2,3,4].map((level) => <span key={level} className={'activity-cell level-' + level} />)}<span>Mais</span></div>
  </section>;
}

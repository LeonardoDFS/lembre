import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import CardsPage, { type Deck } from './Cards';
import StudyPage, { type Queue } from './Study';
import ActivityMap, { type Activity } from './ActivityMap';

type User = { id: string; name: string; role: 'owner' | 'member'; active?: number };
type Language = { id: string; name: string; code: string | null };
type Settings = { theme: 'light' | 'dark'; newPerDay: number; reviewPerSession: number; timezone: string };
type View = 'home' | 'decks' | 'cards' | 'study' | 'users' | 'data';
type StudyMode = 'all' | 'new' | 'due';
type Stats = { totalReviews: number; reviewedToday: number; timeTodayMs: number; streakDays: number };
type Dialog = 'language' | 'editLanguage' | 'deck' | 'editDeck' | 'user' | 'resetUser' | null;
type Backup = { name: string; bytes: number; modifiedAt: string };

export default function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [queue, setQueue] = useState<Queue>({ dueCount: 0, newCount: 0, items: [] });
  const [stats, setStats] = useState<Stats>({ totalReviews: 0, reviewedToday: 0, timeTodayMs: 0, streakDays: 0 });
  const [activity, setActivity] = useState<Activity>({ today: '', days: [] });
  const [stopped, setStopped] = useState(false);
  const [dataMessage, setDataMessage] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [restoreName, setRestoreName] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restorePhrase, setRestorePhrase] = useState('');
  const [settings, setSettings] = useState<Settings>({ theme: 'light', newPerDay: 10, reviewPerSession: 10, timezone: 'America/Sao_Paulo' });
  const [view, setView] = useState<View>('home');
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const [practice, setPractice] = useState(false);
  const [studyMode, setStudyMode] = useState<StudyMode>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLanguageId, setFormLanguageId] = useState('');
  const [search, setSearch] = useState('');
  const activeDeck = decks.find((deck) => deck.id === activeDeckId);

  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => {
    if (!user || stopped) return;
    const refreshQueue = () => {
      if (document.visibilityState === 'visible') {
        api<Queue>('/study/queue').then(setQueue).catch(() => {});
      }
    };
    const timer = window.setInterval(refreshQueue, 60_000);
    window.addEventListener('focus', refreshQueue);
    document.addEventListener('visibilitychange', refreshQueue);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshQueue);
      document.removeEventListener('visibilitychange', refreshQueue);
    };
  }, [user?.id, stopped]);
  useEffect(() => {
    if (view === 'data' && user?.role === 'owner') {
      api<Backup[]>('/data/backups').then(setBackups)
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível listar os backups.'));
    }
  }, [view, user?.role]);

  async function loadData(role?: User['role']) {
    const [langs, deckList, nextQueue, nextSettings, nextStats, nextActivity] = await Promise.all([
      api<Language[]>('/languages'), api<Deck[]>('/decks'), api<Queue>('/study/queue'), api<Settings>('/settings'), api<Stats>('/study/stats'), api<Activity>('/study/activity')
    ]);
    setLanguages(langs); setDecks(deckList); setQueue(nextQueue); setSettings(nextSettings); setStats(nextStats); setActivity(nextActivity);
    if (role === 'owner') setUsers(await api<User[]>('/users'));
  }

  useEffect(() => {
    (async () => {
      try {
        const status = await api<{ needsSetup: boolean }>('/setup/status');
        setNeedsSetup(status.needsSetup);
        if (!status.needsSetup) {
          try {
            const current = await api<User>('/me');
            setUser(current);
            await loadData(current.role);
          } catch {
            // Sem sessão válida, a tela de login permanece visível.
          }
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao servidor.');
      } finally { setLoading(false); }
    })();
  }, []);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const current = await api<User>(needsSetup ? '/setup' : '/login', 'POST', { name: authName, password: authPassword });
      setUser(current); setNeedsSetup(false); setAuthPassword(''); setLoginNotice('');
      await loadData(current.role);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  }
  async function shutdown() {
    if (!window.confirm('Desligar o Lembre neste PC? O acesso pelo celular também será interrompido até você abrir o app novamente.')) return;
    setError(''); setBusy(true);
    try {
      await api('/shutdown', 'POST');
      setStopped(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível desligar o app.');
    } finally { setBusy(false); }
  }
  async function logout() {
    await api('/logout', 'POST');
    setUser(null); setLanguages([]); setDecks([]); setUsers([]); setView('home');
    setQueue({ dueCount: 0, newCount: 0, items: [] });
  }
  async function updateNewLimit(value: number) {
    setError('');
    try {
      await api('/settings', 'PATCH', { newPerDay: value });
      await loadData(user?.role);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o limite diário.'); }
  }
  async function updateReviewLimit(value: number) {
    setError('');
    try {
      await api('/settings', 'PATCH', { reviewPerSession: value });
      await loadData(user?.role);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o limite de revisões.'); }
  }
  async function toggleTheme() {
    const next = settings.theme === 'light' ? 'dark' : 'light';
    setError('');
    try {
      const saved = await api<Settings>('/settings', 'PATCH', { theme: next });
      setSettings({ ...settings, ...saved });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o tema.'); }
  }
  async function exportData() {
    setError(''); setDataMessage(''); setBusy(true);
    try {
      const result = await api<{ path: string }>('/data/export', 'POST');
      setDataMessage('Exportação criada em ' + result.path);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível exportar.'); }
    finally { setBusy(false); }
  }
  async function backupData() {
    setError(''); setDataMessage(''); setBusy(true);
    try {
      const result = await api<{ path: string }>('/data/backup', 'POST');
      setDataMessage('Cópia do banco criada em ' + result.path);
      setBackups(await api<Backup[]>('/data/backups'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a cópia.'); }
    finally { setBusy(false); }
  }
  async function changeOwnPassword(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/me/password', 'POST', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setAuthName(user?.name ?? '');
      setLoginNotice('Senha alterada. Entre novamente com a nova senha.');
      setUser(null); setView('home');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.'); }
    finally { setBusy(false); }
  }
  async function restoreBackup(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/data/restore-backup', 'POST', {
        name: restoreName, currentPassword: restorePassword, confirmation: restorePhrase
      });
      setRestorePassword(''); setRestorePhrase(''); setRestoreName('');
      setAuthName(user?.name ?? '');
      setLoginNotice('Backup completo restaurado. Entre com a senha da conta que estava no backup.');
      setUser(null); setView('home');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o backup.'); }
    finally { setBusy(false); }
  }
  async function toggleUser(item: User) {
    const activating = !item.active;
    if (!window.confirm((activating ? 'Reativar ' : 'Desativar ') + item.name + '? ' +
      (activating ? 'A pessoa poderá entrar novamente.' : 'As sessões da pessoa serão encerradas; seus dados serão preservados.'))) return;
    setError(''); setBusy(true);
    try {
      await api('/users/' + item.id, 'PATCH', { active: activating });
      await loadData(user?.role);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o usuário.'); }
    finally { setBusy(false); }
  }
  function openResetUser(item: User) {
    setSelectedUser(item); setAuthPassword(''); setDialog('resetUser'); setError('');
  }
  async function importData(file: File | undefined) {
    if (!file) return;
    if (file.size > 95 * 1024 * 1024) { setError('O arquivo deve ter até 95 MB.'); return; }
    if (!window.confirm('Restaurar este arquivo? Seus idiomas, baralhos, cartões e revisões atuais serão substituídos. Uma cópia de segurança será criada antes.')) return;
    setError(''); setDataMessage(''); setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const result = await api<{ backupPath: string }>('/data/import', 'POST', { data });
      await loadData(user?.role);
      setDataMessage('Dados restaurados. Cópia anterior: ' + result.backupPath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o arquivo.'); }
    finally { setBusy(false); }
  }
  function openDialog(next: Dialog, deck?: Deck, language?: Language) {
    setDialog(next); setSelectedDeck(deck ?? null); setSelectedLanguage(language ?? null);
    if (next === 'user') setAuthPassword('');
    setFormName(language?.name ?? deck?.name ?? ''); setFormDescription(deck?.description ?? '');
    setFormLanguageId(deck?.languageId ?? languages[0]?.id ?? ''); setError('');
  }
  async function saveDialog(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (dialog === 'language') await api('/languages', 'POST', { name: formName });
      else if (dialog === 'editLanguage' && selectedLanguage) await api('/languages/' + selectedLanguage.id, 'PATCH', { name: formName });
      else if (dialog === 'deck') await api('/decks', 'POST', { name: formName, description: formDescription, languageId: formLanguageId });
      else if (dialog === 'editDeck' && selectedDeck) await api('/decks/' + selectedDeck.id, 'PATCH', { name: formName, description: formDescription });
      else if (dialog === 'user') {
        await api('/users', 'POST', { name: formName, password: authPassword });
        setAuthPassword('');
      } else if (dialog === 'resetUser' && selectedUser) {
        await api('/users/' + selectedUser.id + '/password', 'POST', { password: authPassword });
        setAuthPassword('');
      }
      await loadData(user?.role); setDialog(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  async function removeLanguage(language: Language) {
    const count = decks.filter((deck) => deck.languageId === language.id).length;
    if (!window.confirm('Excluir “' + language.name + '” com ' + count + ' baralho(s), todos os cartões e o histórico deles?')) return;
    setError('');
    try { await api('/languages/' + language.id, 'DELETE'); await loadData(user?.role); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o idioma.'); }
  }
  async function removeDeck(deck: Deck) {
    if (!window.confirm(`Excluir “${deck.name}” e todos os cartões e revisões dele? Essa ação não pode ser desfeita.`)) return;
    setError('');
    try { await api('/decks/' + deck.id, 'DELETE'); await loadData(user?.role); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir.'); }
  }
  function startStudy(deckId: string | null) {
    setPractice(false); setStudyDeckId(deckId); setView('study'); setError('');
  }
  function startPractice() {
    setPractice(true); setStudyDeckId(null); setView('study'); setError('');
  }
  const filteredDecks = decks.filter((deck) =>
    (deck.name + ' ' + deck.languageName + ' ' + deck.description).toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR'))
  );
  const totalCards = decks.reduce((sum, deck) => sum + deck.cardCount, 0);
  const available = queue.dueCount + queue.newCount;

  if (stopped) return <div className="center-screen stopped-screen"><div><h1>Lembre desligado</h1><p>Suas revisões foram salvas. Abra o Lembre.exe para usar novamente.</p></div></div>;
  if (loading) return <div className="center-screen">Carregando Lembre...</div>;
  if (!user) return <main className="auth-page">
    <div className="auth-aside"><div className="brand"><span className="brand-mark">L</span> Lembre<span className="brand-dot">•</span></div>
      <h1>Um lugar tranquilo<br />para aprender sempre.</h1><p>Organize o que você estuda e construa uma rotina que cabe no seu dia.</p></div>
    <form className="auth-card" onSubmit={submitAuth}>
      <div className="eyebrow">{needsSetup ? 'PRIMEIRO ACESSO' : 'BEM-VINDO DE VOLTA'}</div>
      <h2>{needsSetup ? 'Crie sua conta principal' : 'Entre no Lembre'}</h2>
      <p>{needsSetup ? 'Comece com seu nome e uma senha. Depois você poderá adicionar outras pessoas da casa.' : 'Seus baralhos e seu progresso esperam por você.'}</p>
      <label>Nome<input value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="username" required maxLength={80} /></label>
      <label>Senha<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required minLength={needsSetup ? 10 : undefined} /></label>
      {needsSetup && <small>Use pelo menos 10 caracteres.</small>}
      {loginNotice && <div className="success" role="status">{loginNotice}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary full" disabled={busy}>{busy ? 'Aguarde...' : needsSetup ? 'Criar conta' : 'Entrar'}</button>
      {needsSetup && <span className="auth-note">Crie a primeira conta no próprio PC.</span>}
    </form>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">L</span> Lembre<span className="brand-dot">•</span></div>
      <div className="side-label">SEU ESPAÇO</div>
      <button className={'nav-item ' + (view === 'home' ? 'active' : '')} onClick={() => setView('home')}>⌂ <span>Início</span></button>
      <button className={'nav-item ' + (view === 'decks' || view === 'cards' ? 'active' : '')} onClick={() => setView('decks')}>▣ <span>Meus baralhos</span></button>
      <button className={'nav-item ' + (view === 'data' ? 'active' : '')} onClick={() => setView('data')}>⚙ <span>Dados e ajustes</span></button>
      {user.role === 'owner' && <button className={'nav-item ' + (view === 'users' ? 'active' : '')} onClick={() => setView('users')}>♙ <span>Usuários</span></button>}
      <div className="sidebar-bottom"><div className="profile-avatar">{user.name.charAt(0).toUpperCase()}</div>
        <div className="profile-text"><strong>{user.name}</strong><small>{user.role === 'owner' ? 'Conta principal' : 'Estudante'}</small></div>
        <button className="text-button" onClick={logout} title="Sair da conta">Sair</button></div>
      {user.role === 'owner' && <button className="shutdown-button" disabled={busy} onClick={shutdown}>⏻ Desligar app</button>}
    </aside>
    <div className="main-area">
      <header className="topbar"><span>{view === 'home' ? 'Início' : view === 'decks' ? 'Meus baralhos' : view === 'cards' ? activeDeck?.name : view === 'study' ? 'Sessão de estudo' : view === 'data' ? 'Dados e ajustes' : 'Usuários'}</span>
        <div className="top-actions"><button className="theme-button" onClick={toggleTheme} aria-label={settings.theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'} title={settings.theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>{settings.theme === 'dark' ? '☀' : '☾'} <span>{settings.theme === 'dark' ? 'Claro' : 'Escuro'}</span></button>
        <button className="ghost small" onClick={() => openDialog('language')}>+ Idioma</button></div></header>
      <main className="content">
        {error && !dialog && <div className="error" role="alert">{error}</div>}
        {view === 'home' && <>
          <div className="eyebrow">SEU ESPAÇO DE ESTUDO</div><h1>Olá, {user.name}.</h1>
          <p className="intro">Um pouco de prática hoje ajuda você a lembrar amanhã.</p>
          <section className="hero"><div><span className="hero-kicker">REVISÃO DE HOJE</span>
            <h2>{available ? `${available} ${available === 1 ? 'cartão para estudar' : 'cartões para estudar'}` : totalCards ? 'Tudo em dia por enquanto.' : 'Vamos montar seu espaço de estudo?'}</h2>
            <p>{available ? `${queue.dueCount} vencidos · ${queue.newCount} novos disponíveis` : totalCards ? 'Volte quando houver uma nova revisão ou crie mais cartões.' : 'Crie um idioma, um baralho e seu primeiro cartão.'}</p>
            <div className="hero-actions">{available ? <button className="light-button" onClick={() => startStudy(null)}>Começar revisão →</button>
              : <button className="light-button" onClick={() => { if (!languages.length) openDialog('language'); else if (!decks.length) openDialog('deck'); else { setActiveDeckId(decks[0].id); setView('cards'); } }}>{!languages.length ? '+ Criar idioma' : !decks.length ? '+ Criar baralho' : '+ Criar cartão'}</button>}
              {decks.length > 0 && <button className="hero-link" onClick={() => setView('decks')}>Ver baralhos →</button>}
              {stats.totalReviews > 0 && <button className="hero-link" onClick={startPractice}>Treino livre ↗</button>}</div>
          </div><div className="hero-symbol">✦</div></section>
          <div className="stats-grid"><div className="stat-card"><span>Revisões vencidas</span><strong>{queue.dueCount}</strong></div>
            <div className="stat-card"><span>Novos disponíveis</span><strong>{queue.newCount}</strong></div>
            <div className="stat-card"><span>Cartões criados</span><strong>{totalCards}</strong></div>
            <div className="stat-card"><span>Revisados hoje</span><strong>{stats.reviewedToday}</strong></div>
            <div className="stat-card"><span>Tempo hoje</span><strong>{Math.round(stats.timeTodayMs / 60000)} min</strong></div>
            <div className="stat-card"><span>Sequência</span><strong>{stats.streakDays} {stats.streakDays === 1 ? 'dia' : 'dias'}</strong></div></div>
          <ActivityMap activity={activity} />
          <div className="study-options">
            <label>Novos por dia<select aria-label="Cartões novos por dia" value={settings.newPerDay} onChange={(event) => updateNewLimit(Number(event.target.value))}>
              {[0, 5, 10, 20, 50].map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Revisões por sessão<select aria-label="Revisões por sessão" value={settings.reviewPerSession} onChange={(event) => updateReviewLimit(Number(event.target.value))}>
              {[5, 10, 20, 0].map((value) => <option key={value} value={value}>{value || 'Sem limite'}</option>)}
            </select></label>
            <label>Estudar<select aria-label="Tipo de sessão" value={studyMode} onChange={(event) => setStudyMode(event.target.value as StudyMode)}>
              <option value="all">Revisões e novos</option><option value="new">Só novos</option><option value="due">Só revisões vencidas</option>
            </select></label>
            <small>Os novos entram primeiro. Revisões além do limite continuam pendentes; novos respeitam o limite diário.</small>
          </div>
          <div className="section-heading"><h2>Seus idiomas</h2><button className="text-button" onClick={() => openDialog('language')}>+ Adicionar idioma</button></div>
          {languages.length ? <div className="language-list">{languages.map((language) => <div className="language-entry" key={language.id}>
              <button className="language-main" onClick={() => setView('decks')}><span className="language-icon">文</span><strong>{language.name}</strong><span>{decks.filter((deck) => deck.languageId === language.id).length} baralhos →</span></button>
              <div><button className="text-button" onClick={() => openDialog('editLanguage', undefined, language)}>Renomear</button>
                <button className="danger-text" onClick={() => removeLanguage(language)}>Excluir</button></div>
            </div>)}</div>
            : <div className="empty">Nenhum idioma ainda. Adicione inglês para começar.</div>}
        </>}
        {view === 'decks' && <>
          <div className="eyebrow">BIBLIOTECA</div><div className="page-title"><div><h1>Meus baralhos</h1><p className="intro">Organize seus estudos por idioma e assunto.</p></div>
            <button className="primary" onClick={() => openDialog(languages.length ? 'deck' : 'language')}>+ Novo baralho</button></div>
          {decks.length > 0 && <input className="search" placeholder="Buscar baralho ou idioma..." value={search} onChange={(event) => setSearch(event.target.value)} />}
          {filteredDecks.length ? <div className="deck-grid">{filteredDecks.map((deck) => <article className="deck-card" key={deck.id}>
            <div className="deck-top"><span className="pill">{deck.languageName}</span><span className="deck-count">{deck.cardCount} cartões</span></div>
            <h2>{deck.name}</h2><p>{deck.description || 'Seu espaço para reunir cartões deste tema.'}</p>
            <div className="deck-actions"><button className="primary small" onClick={() => { setActiveDeckId(deck.id); setView('cards'); }}>Cartões</button>
              <button className="ghost small" disabled={!deck.cardCount} onClick={() => startStudy(deck.id)}>Estudar</button>
              <button className="ghost small" onClick={() => openDialog('editDeck', deck)}>Editar</button>
              <button className="danger-text" onClick={() => removeDeck(deck)}>Excluir</button></div>
          </article>)}</div> : <div className="empty">{decks.length ? 'Nenhum baralho corresponde à busca.' : 'Você ainda não criou um baralho. Crie um para organizar seus primeiros cartões.'}</div>}
        </>}
        {view === 'cards' && activeDeck && <CardsPage deck={activeDeck} onBack={() => setView('decks')} onChanged={() => loadData(user.role)} />}
        {view === 'study' && <StudyPage practice={practice} deckId={studyDeckId} mode={studyMode} reviewLimit={settings.reviewPerSession} onBack={() => { setView('home'); loadData(user.role).catch((cause) => setError(cause.message)); }} onChanged={() => loadData(user.role)} />}
        {view === 'data' && <>
          <div className="eyebrow">SEUS DADOS</div><h1>Dados e ajustes</h1>
          <p className="intro">Seus dados ficam neste PC, em uma pasta separada do código. Cada conta tem seus próprios baralhos e progresso.</p>
          <div className="data-grid">
            <section className="data-card"><h2>Exportar meus estudos</h2>
              <p>Cria um arquivo JSON com seus idiomas, cartões e histórico de revisão na pasta lembre-data&#92;exports.</p>
              <button className="primary" disabled={busy} onClick={exportData}>Criar exportação</button></section>
            <section className="data-card"><h2>Restaurar exportação</h2>
              <p>Substitui apenas os dados desta conta. O Lembre cria uma cópia completa do banco antes de restaurar.</p>
              <label className="ghost file-button">Escolher arquivo JSON
                <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
                  const file = event.target.files?.[0];
                  void importData(file);
                  event.target.value = '';
                }} /></label></section>
            {user.role === 'owner' && <section className="data-card"><h2>Backup completo</h2>
              <p>Copia o banco inteiro, incluindo todas as contas. Uma cópia automática é criada a cada dia em que o servidor é iniciado.</p>
              <button className="ghost" disabled={busy} onClick={backupData}>Criar backup agora</button></section>}
            <section className="data-card"><h2>Alterar minha senha</h2>
              <p>Informe a senha atual. Depois da alteração, entre novamente com a nova senha.</p>
              <form className="data-form" onSubmit={changeOwnPassword}>
                <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                <label>Nova senha<input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                <button className="ghost" disabled={busy}>Alterar senha</button>
              </form></section>
            {user.role === 'owner' && <section className="data-card data-card-wide"><h2>Restaurar backup completo</h2>
              <p>Substitui todas as contas, cartões e revisões pelos dados do backup escolhido. O Lembre cria uma cópia do banco atual antes e encerra todas as sessões. Para entrar depois, use uma senha que existia no backup.</p>
              <form className="data-form" onSubmit={restoreBackup}>
                <label>Backup<select value={restoreName} onChange={(event) => setRestoreName(event.target.value)} required>
                  <option value="">Selecione um backup</option>
                  {backups.map((backup) => <option key={backup.name} value={backup.name}>{backup.name} · {new Date(backup.modifiedAt).toLocaleString('pt-BR')}</option>)}
                </select></label>
                <label>Sua senha atual<input type="password" autoComplete="current-password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} required /></label>
                <label>Digite RESTAURAR para confirmar<input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} required /></label>
                <button className="danger-button" disabled={busy || !restoreName || restorePhrase !== 'RESTAURAR'}>Restaurar banco completo</button>
              </form></section>}
          </div>
          {dataMessage && <div className="success" role="status">{dataMessage}</div>}
          <p className="data-note">Backups ficam na pasta de dados do Lembre, em backups. As últimas 7 cópias automáticas são mantidas; cópias manuais e anteriores à restauração não são apagadas automaticamente.</p>
        </>}
        {view === 'users' && user.role === 'owner' && <>
          <div className="eyebrow">PESSOAS DA CASA</div><div className="page-title"><div><h1>Usuários</h1><p className="intro">Cada pessoa tem seus próprios baralhos e progresso.</p></div>
            <button className="primary" onClick={() => openDialog('user')}>+ Criar usuário</button></div>
          <div className="user-list">{users.map((item) => <div key={item.id}><span className="profile-avatar">{item.name.charAt(0).toUpperCase()}</span>
            <strong>{item.name}</strong><span className="user-status">{item.role === 'owner' ? 'Conta principal' : item.active ? 'Ativo' : 'Desativado'}</span>
            {item.role === 'member' && <div className="user-actions"><button className="ghost small" disabled={busy} onClick={() => openResetUser(item)}>Redefinir senha</button>
              <button className="ghost small" disabled={busy} onClick={() => toggleUser(item)}>{item.active ? 'Desativar' : 'Reativar'}</button></div>}
          </div>)}</div>
        </>}
      </main>
    </div>
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
      <form className="modal" onSubmit={saveDialog}>
        <div className="modal-head"><div className="eyebrow">LEMBRE</div><button type="button" className="close" onClick={() => setDialog(null)} aria-label="Fechar">×</button></div>
        <h2>{dialog === 'language' ? 'Adicionar idioma' : dialog === 'editLanguage' ? 'Renomear idioma' : dialog === 'deck' ? 'Criar baralho' : dialog === 'editDeck' ? 'Editar baralho' : dialog === 'resetUser' ? 'Redefinir senha de ' + selectedUser?.name : 'Criar usuário'}</h2>
        {dialog !== 'resetUser' && <label>{dialog === 'language' || dialog === 'editLanguage' ? 'Idioma' : dialog === 'user' ? 'Nome' : 'Nome do baralho'}<input autoFocus value={formName} onChange={(event) => setFormName(event.target.value)} maxLength={dialog === 'deck' ? 100 : 80} required placeholder={dialog === 'language' ? 'Ex.: Inglês' : dialog === 'user' ? 'Nome da pessoa' : 'Ex.: Conversação do dia a dia'} /></label>}
        {(dialog === 'deck' || dialog === 'editDeck') && <>
          {dialog === 'deck' && <label>Idioma<select value={formLanguageId} onChange={(event) => setFormLanguageId(event.target.value)} required>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>}
          <label>Descrição <span className="optional">opcional</span><textarea value={formDescription} onChange={(event) => setFormDescription(event.target.value)} maxLength={500} rows={3} placeholder="Sobre o que é este baralho?" /></label>
        </>}
        {(dialog === 'user' || dialog === 'resetUser') && <label>{dialog === 'resetUser' ? 'Nova senha' : 'Senha inicial'}<input type="password" minLength={10} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required placeholder="Pelo menos 10 caracteres" /></label>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="ghost" onClick={() => setDialog(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button></div>
      </form>
    </div>}
  </div>;
}



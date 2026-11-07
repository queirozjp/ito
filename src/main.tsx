import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, PrivateState, PublicState } from './types';
import './style.css';

const playerInvite = new URLSearchParams(location.search).get('convite');
const socket: Socket = io({ autoConnect: false, reconnection: true, auth: { invite: playerInvite } });
const themes = ['Quão perigoso é este animal?', 'Quão difícil é realizar esta atividade?', 'Quão assustadora é esta situação?', 'Quão constrangedora é esta experiência?', 'Qual seria a sua reação diante desta situação?'];
type Response = { ok: boolean; error?: string; token?: string };
const call = (event: string, payload?: unknown): Promise<Response> => new Promise(resolve => {
  const timer = setTimeout(() => resolve({ ok: false, error: 'Sem resposta do servidor. Tente novamente.' }), 7000);
  socket.emit(event, payload, (result: Response) => { clearTimeout(timer); resolve(result); });
});
const role = location.pathname.startsWith('/jogar') ? 'player' : 'host';

function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [privateState, setPrivateState] = useState<PrivateState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [playerId, setPlayerId] = useState<string | null>(localStorage.getItem('os-player-id'));
  const [hostToken, setHostToken] = useState<string | null>(localStorage.getItem('os-host-token'));
  const [hostInvite, setHostInvite] = useState('');
  const [publicMode, setPublicMode] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [animatingDraw, setAnimatingDraw] = useState(false);

  useEffect(() => {
    fetch('/api/network').then(r => r.json()).then(data => { setUrls(data.addresses ?? []); setPublicMode(!!data.publicMode); }).catch(() => {});
    const reconnect = async () => {
      setConnected(true);
      const token = localStorage.getItem(role === 'host' ? 'os-host-token' : 'os-player-token');
      if (!token) return;
      const result = role === 'host'
        ? await call('host:join', token)
        : await call('player:join', { playerId: localStorage.getItem('os-player-id'), token });
      if (!result.ok) {
        if (role === 'host') { localStorage.removeItem('os-host-token'); setHostToken(null); }
        else { localStorage.removeItem('os-player-token'); localStorage.removeItem('os-player-id'); setPlayerId(null); setPrivateState(null); }
      }
    };
    const onState = (next: PublicState | null) => {
      setState(next);
      if (!next) { setPrivateState(null); setHostInvite(''); localStorage.removeItem('os-player-token'); localStorage.removeItem('os-player-id'); localStorage.removeItem('os-host-token'); setPlayerId(null); setHostToken(null); }
    };
    const replaced = () => { setError('Esta sessão foi aberta em outro dispositivo ou aba.'); socket.disconnect(); setConnected(false); };
    socket.on('connect', reconnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', onState);
    socket.on('private', setPrivateState);
    socket.on('host:invite', setHostInvite);
    socket.on('session:replaced', replaced);
    socket.connect();
    return () => { socket.off('connect', reconnect); socket.off('disconnect'); socket.off('state', onState); socket.off('private', setPrivateState); socket.off('host:invite', setHostInvite); socket.off('session:replaced', replaced); socket.disconnect(); };
  }, []);

  const act = async (event: string, payload?: unknown) => {
    setError('');
    const result = await call(event, payload);
    if (!result.ok) setError(result.error ?? 'Não foi possível concluir a ação.');
    return result;
  };

  const join = async (id: string) => {
    const result = await act('player:join', { playerId: id });
    if (result.ok && result.token) {
      localStorage.setItem('os-player-id', id); localStorage.setItem('os-player-token', result.token); setPlayerId(id);
    }
  };
  const create = async (names: string[], theme: string, code: string) => {
    const result = await act('host:create', { names, theme, hostCode: code });
    if (result.ok && result.token) { localStorage.setItem('os-host-token', result.token); setHostToken(result.token); }
  };
  const draw = async () => {
    setAnimatingDraw(true);
    await act('player:draw');
    setTimeout(() => setAnimatingDraw(false), 850);
  };
  const end = async () => {
    if (!window.confirm('Encerrar a partida para todos os jogadores?')) return;
    const result = await act('host:end');
    if (result.ok) { localStorage.removeItem('os-host-token'); setHostToken(null); }
  };

  return <div className={`app ${role}`}>
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="topbar"><div className="brand"><span className="brand-mark">✦</span><span>ORDEM <b>SECRETA</b></span></div><div className="top-right"><span className={`connection ${connected ? 'online' : ''}`}>{connected ? 'Conectado' : 'Reconectando...'}</span><span className="role-badge">{role === 'host' ? 'TELA DO HOST' : 'JOGADOR'}</span></div></header>
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar">×</button></div>}
    {role === 'host'
      ? <Host state={state} hostToken={hostToken} hostInvite={hostInvite} publicMode={publicMode} urls={urls} act={act} create={create} end={end}/>
      : <PlayerView state={state} privateState={privateState} playerId={playerId} publicMode={publicMode} join={join} act={act} draw={draw} animatingDraw={animatingDraw}/>}
    <footer>Um jogo de pistas, intuição e trabalho em equipe <span>•</span> 0 — 100</footer>
  </div>;
}

function Host({ state, hostToken, hostInvite, publicMode, urls, act, create, end }: {
  state: PublicState | null; hostToken: string | null; hostInvite: string; publicMode: boolean; urls: string[];
  act: (event: string, payload?: unknown) => Promise<Response>; create: (names: string[], theme: string, code: string) => Promise<void>; end: () => Promise<void>;
}) {
  const [names, setNames] = useState(['João', 'Pedro', 'Lucas', 'Gabriel']);
  const [theme, setTheme] = useState(themes[0]);
  const [code, setCode] = useState('');
  const [editTheme, setEditTheme] = useState(false);
  useEffect(() => { if (state?.phase === 'lobby') setTheme(state.theme); }, [state?.theme, state?.phase]);
  const link = publicMode ? (hostInvite ? `${location.origin}/jogar?convite=${encodeURIComponent(hostInvite)}` : '') : `${urls[0] ?? location.origin}/jogar`;
  const canStart = state?.players.every(p => p.connected && p.ready);

  if (!state) return <main className="page centered"><div className="hero-eyebrow">{publicMode ? 'MULTIPLAYER ONLINE' : 'MULTIPLAYER LOCAL'} · 4 JOGADORES</div><h1>Uma ordem.<br/><em>Oito segredos.</em></h1><p className="hero-copy">Cada pessoa conhece apenas suas cartas. Juntos, vocês precisam colocá-las do menor para o maior usando pistas criativas.</p><div className="panel setup"><h2>Criar partida</h2><p>Defina os participantes e o tema da primeira rodada.</p><div className="name-grid">{names.map((name, i) => <label key={i} className="field"><span>JOGADOR {i + 1}</span><input value={name} maxLength={24} onChange={e => setNames(old => old.map((v, j) => i === j ? e.target.value : v))}/></label>)}</div><label className="field"><span>TEMA DA RODADA</span><select value={themes.includes(theme) ? theme : '__custom'} onChange={e => setTheme(e.target.value === '__custom' ? '' : e.target.value)}>{themes.map(t => <option key={t}>{t}</option>)}<option value="__custom">Escrever meu próprio tema</option></select></label>{!themes.includes(theme) && <input className="custom-theme" placeholder="Escreva uma pergunta para a escala de 0 a 100" value={theme} maxLength={160} onChange={e => setTheme(e.target.value)}/> }{publicMode && <label className="field host-code"><span>CÓDIGO DO HOST</span><input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="Código configurado no servidor"/></label>}<button className="button primary wide" onClick={() => create(names, theme, code)}>Criar partida <span>↗</span></button></div></main>;
  if (!hostToken) return <main className="page centered"><div className="panel setup"><h2>Partida em andamento</h2><p>Esta tela precisa da sessão do host. Abra a aba original ou reinicie o servidor para começar outra partida.</p></div></main>;

  return <main className="page host-main">
    <div className="round-header"><div><div className="eyebrow">{state.phase === 'lobby' ? 'SALA DE ESPERA' : `RODADA ${String(state.round).padStart(2, '0')}`}</div><h1>{state.phase === 'lobby' ? 'Prepare a equipe.' : 'Encontre a ordem.'}</h1></div><div className="phase-pill">{phaseLabel(state.phase)}</div></div>
    <section className="theme-banner"><div className="theme-icon">✳</div><div><span>O TEMA DA RODADA</span><h2>{state.theme}</h2><small>Escala de 0 (mínimo) a 100 (máximo)</small></div></section>
    {state.phase === 'lobby' && <div className="lobby-layout"><div className="panel lobby-panel"><div className="section-heading"><div><span className="eyebrow">SUA EQUIPE</span><h2>Jogadores</h2></div><span>{state.players.filter(p => p.connected).length}/4 conectados</span></div><div className="player-list">{state.players.map(p => <div className="player-row" key={p.id}><span className="avatar" style={{ '--accent': p.color } as React.CSSProperties}>{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name}</strong><span className={`status ${p.ready ? 'ready' : p.connected ? 'connected' : ''}`}>{p.ready ? 'Pronto' : p.connected ? 'Conectado' : 'Aguardando'}</span></div>)}</div><div className="theme-edit"><button className="text-button" onClick={() => setEditTheme(!editTheme)}>{editTheme ? 'Fechar edição' : 'Alterar tema'} ↗</button>{editTheme && <div className="edit-controls"><input value={theme} onChange={e => setTheme(e.target.value)} maxLength={160}/><button className="button secondary" onClick={async () => { const r = await act('host:theme', theme); if (r.ok) setEditTheme(false); }}>Salvar tema</button></div>}</div><button className="button primary wide" disabled={!canStart} onClick={() => act('host:start')}>Iniciar rodada <span>→</span></button><p className="hint">{canStart ? 'Todos estão prontos. Boa sorte!' : 'Aguarde os quatro jogadores ficarem prontos.'}</p></div><div className="panel invite-panel"><span className="eyebrow">CONVIDE A EQUIPE</span><h2>Entre pelo celular</h2><p>Abra o link abaixo em cada celular.</p><div className="qr">{link ? <QRCodeSVG value={link} size={168} bgColor="#ffffff" fgColor="#151438" marginSize={1}/> : <span>Preparando convite...</span>}</div><div className="link-box">{link || "Preparando convite..."}<button disabled={!link} onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button></div>{!publicMode && urls.length > 1 && <div className="other-ips">Outros endereços: {urls.slice(1).map(u => <div key={u}>{u}/jogar</div>)}</div>}</div></div>}
    {state.phase !== 'lobby' && <><div className="players-strip">{state.players.map(p => <div key={p.id} className="mini-player" style={{ '--accent': p.color } as React.CSSProperties}><i/><b>{p.name}</b><span>{p.drawn ? '2 cartas' : p.connected ? 'Sorteando' : 'Desconectado'}</span></div>)}</div><div className="section-heading order-title"><div><span className="eyebrow">A SEQUÊNCIA DO GRUPO</span><h2>Ordem escolhida <span className="arrow">Menor → Maior</span></h2></div><span>{state.phase === 'discussion' ? 'Arraste as cartas para reorganizar' : state.phase === 'draw' ? 'Aguardando os sorteios' : 'Ordem travada'}</span></div><OrderBoard state={state} act={act}/>{state.phase === 'discussion' && <div className="confirm-area"><button className="button primary confirm" onClick={() => { if (window.confirm('Tem certeza? Após confirmar, as cartas serão reveladas e a ordem não poderá mais ser alterada.')) act('host:confirm'); }}>Confirmar ordem <span>✦</span></button><p>Conversem sobre as pistas antes de confirmar. Esta decisão é final.</p></div>}{state.phase === 'draw' && <div className="waiting-note">✦ &nbsp; Os jogadores estão sorteando suas cartas. A discussão começa assim que todos terminarem.</div>}{state.phase === 'result' && <Result state={state} act={act} end={end} setEditTheme={setEditTheme}/>}</>}
  </main>;
}

function SortableCard({ card, state, position }: { card: Card; state: PublicState; position: number }) {
  const player = state.players.find(p => p.id === card.playerId)!;
  const sortable = useSortable({ id: card.id, disabled: state.phase !== 'discussion' });
  const revealed = state.revealed?.find(c => c.id === card.id);
  const wrong = state.phase === 'result' && state.correctOrder?.[position] !== card.id;
  const style: React.CSSProperties = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, '--accent': player.color, '--delay': `${position * 0.65}s` } as React.CSSProperties;
  return <div ref={sortable.setNodeRef} style={style} {...sortable.attributes} {...sortable.listeners} className={`sort-card ${sortable.isDragging ? 'dragging' : ''} ${state.phase === 'reveal' ? 'is-revealing' : ''} ${state.phase === 'result' ? 'finished' : ''} ${wrong ? 'wrong' : ''}`}><div className="card-inner"><div className="card-face card-back"><div className="card-symbol">✦</div><span className="card-owner">{player.name}</span><b>CARTA {card.index}</b><span className="card-question">?</span></div><div className="card-face card-front"><span className="card-owner">{player.name}</span><span className="card-number">{revealed?.value}</span><b>CARTA {card.index}</b></div></div><span className="position-number">{String(position + 1).padStart(2, '0')}</span></div>;
}
function OrderBoard({ state, act }: { state: PublicState; act: (event: string, payload?: unknown) => Promise<Response> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const cards = useMemo(() => new Map(state.cards.map(c => [c.id, c])), [state.cards]);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = state.order.indexOf(String(active.id));
    const newIndex = state.order.indexOf(String(over.id));
    if (oldIndex >= 0 && newIndex >= 0) act('host:reorder', arrayMove(state.order, oldIndex, newIndex));
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={state.order} strategy={horizontalListSortingStrategy}><div className="order-board">{state.order.map((id, i) => { const card = cards.get(id); return card && <SortableCard key={id} card={card} state={state} position={i}/>; })}</div></SortableContext></DndContext>;
}
function Result({ state, act, end, setEditTheme }: { state: PublicState; act: (event: string, payload?: unknown) => Promise<Response>; end: () => Promise<void>; setEditTheme: (value: boolean) => void }) {
  const byId = new Map(state.revealed?.map(c => [c.id, c]));
  const describe = (id: string) => { const c = byId.get(id)!; const p = state.players.find(p => p.id === c.playerId)!; return `${c.value} · ${p.name} ${c.index}`; };
  return <section className={`result-panel ${state.won ? 'victory' : ''}`}><div className="result-spark">{state.won ? '✦ ✧ ✦' : '✧'}</div><div className="eyebrow">RESULTADO DA RODADA {state.round}</div><h2>{state.won ? 'PERFEITO! VOCÊS ACERTARAM TODAS AS CARTAS!' : 'NÃO FOI DESSA VEZ!'}</h2><p>{state.correctPositions} de 8 cartas na posição correta</p><div className="result-columns"><div><h3>ORDEM ESCOLHIDA</h3><div className="result-sequence">{state.order.map((id, i) => <span key={id} className={state.correctOrder?.[i] === id ? 'correct' : 'incorrect'}>{describe(id)}</span>)}</div></div><div><h3>ORDEM CORRETA</h3><div className="result-sequence">{state.correctOrder?.map(id => <span key={id}>{describe(id)}</span>)}</div></div></div><div className="result-actions"><button className="button primary" onClick={() => act('host:again')}>Jogar novamente ↗</button><button className="button secondary" onClick={async () => { const r = await act('host:lobby'); if (r.ok) setEditTheme(true); }}>Alterar tema</button><button className="button secondary" onClick={() => act('host:lobby')}>Voltar ao lobby</button><button className="button ghost" onClick={end}>Encerrar partida</button></div></section>;
}

function PlayerView({ state, privateState, playerId, publicMode, join, act, draw, animatingDraw }: {
  state: PublicState | null; privateState: PrivateState | null; playerId: string | null; publicMode: boolean;
  join: (id: string) => Promise<void>; act: (event: string, payload?: unknown) => Promise<Response>; draw: () => Promise<void>; animatingDraw: boolean;
}) {
  if (!state) return <main className="page player-page centered"><div className="player-hero-icon">✦</div><h1>{publicMode ? <>Abra o<br/><em>convite.</em></> : <>Aguardando<br/><em>o host.</em></>}</h1><p className="hero-copy">{publicMode ? 'Use o link ou QR Code mostrado na tela do host para entrar na partida.' : 'O host ainda não criou a partida. Esta tela vai atualizar automaticamente.'}</p></main>;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return <main className="page player-page"><div className="eyebrow">BEM-VINDO À PARTIDA</div><h1>Quem é <em>você?</em></h1><p className="hero-copy">Escolha seu nome para entrar. Cada participante usa o próprio celular.</p><div className="choose-list">{state.players.map(p => <button key={p.id} className="choose-player" disabled={p.connected} onClick={() => join(p.id)} style={{ '--accent': p.color } as React.CSSProperties}><span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name}</strong><span>{p.connected ? 'Ocupado' : 'Entrar →'}</span></button>)}</div></main>;
  const myCards = privateState?.playerId === player.id && privateState.round === state.round ? privateState.cards : [];
  return <main className="page player-page"><div className="player-welcome"><span className="eyebrow">{state.phase === 'lobby' ? 'SALA DE ESPERA' : `RODADA ${String(state.round).padStart(2, '0')}`}</span><h1>Olá, <em style={{ color: player.color }}>{player.name}.</em></h1></div><div className="theme-banner mobile-theme"><div className="theme-icon">✳</div><div><span>O TEMA DA RODADA</span><h2>{state.theme}</h2><small>0 = mínimo · 100 = máximo</small></div></div>
    {state.phase === 'lobby' ? <div className="panel mobile-panel"><div className="lobby-art">✦</div><h2>{player.ready ? 'Você está pronto!' : 'Pronto para jogar?'}</h2><p>{player.ready ? 'Aguarde os outros jogadores. O host iniciará a rodada.' : 'Quando todos estiverem prontos, o host poderá iniciar a rodada.'}</p><button className={`button wide ${player.ready ? 'secondary' : 'primary'}`} onClick={() => act('player:ready', !player.ready)}>{player.ready ? 'Cancelar prontidão' : 'Estou pronto →'}</button><div className="ready-count">{state.players.filter(p => p.ready).length} de 4 jogadores prontos</div></div> : <>
      <div className="my-cards-heading"><div><span className="eyebrow">SEUS SEGREDOS</span><h2>Suas cartas</h2></div><span>Somente você vê os números</span></div>
      {myCards.length === 0 ? <div className="panel mobile-panel"><div className="lobby-art">◇</div><h2>Hora do sorteio</h2><p>Você receberá duas cartas únicas. Pense em pistas para o tema sem dizer seus números.</p><button disabled={state.phase !== 'draw'} className="button primary wide" onClick={draw}>Sortear minhas cartas ✦</button></div> : <div className={`my-cards ${animatingDraw ? 'dealing' : ''}`}>{myCards.map((c, i) => <div key={c.id} className="my-card" style={{ '--accent': player.color, '--deal': `${i * 0.18}s` } as React.CSSProperties}><div className="my-card-top"><span>ORDEM SECRETA</span><span>✦</span></div><span className="my-card-value">{c.value}</span><div className="my-card-bottom"><span>CARTA {c.index}</span><span>0 — 100</span></div></div>)}</div>}
      <div className="instruction"><span>✦</span><div><b>{state.phase === 'draw' ? 'Aguardando os outros sorteios' : state.phase === 'discussion' ? 'Converse com o grupo' : state.phase === 'reveal' ? 'Revelando a ordem...' : state.won ? 'Vocês conseguiram!' : 'Fim da rodada'}</b><p>{state.phase === 'discussion' ? 'Crie uma pista para cada carta de acordo com o tema. Não fale os números em voz alta.' : state.phase === 'result' ? `${state.correctPositions} de 8 cartas ficaram na posição correta. Aguarde o host iniciar a próxima rodada.` : 'Suas cartas permanecem com você até o fim da rodada.'}</p></div></div>
    </>}
  </main>;
}
function phaseLabel(phase: string) { return ({ lobby: 'Preparação', draw: 'Sorteio', discussion: 'Discussão', reveal: 'Revelação', result: 'Resultado' } as Record<string, string>)[phase]; }

createRoot(document.getElementById('root')!).render(<App/>);

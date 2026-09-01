'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  COLS,
  FREE_PLOTS,
  SELL_PRICE,
  SEED_COST,
  UPGRADE_DEFS,
  freshPlots,
  initialState,
  ownedCount,
  plotCost,
  growTimeSeconds,
  yieldAmount,
  siloCap,
  upgradeCost,
} from '@/lib/gameLogic';

export default function Home() {
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState(null); // null = logged out

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.loggedIn) setUsername(data.username);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) return null;
  if (!username) return <AuthScreen onLoggedIn={setUsername} />;
  return <Game username={username} onLoggedOut={() => setUsername(null)} />;
}

function AuthScreen({ onLoggedIn }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(mode) {
    setError('');
    if (name.trim().length < 3 || name.trim().length > 16) {
      setError('Choisis un pseudo de 3 à 16 caractères.');
      return;
    }
    if (password.length < 4) {
      setError('Le mot de passe doit faire au moins 4 caractères.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorMessage(data.error));
        return;
      }
      onLoggedIn(data.username);
    } catch {
      setError('Impossible de contacter le serveur, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Wheat2Wealth</h1>
        <p>
          Connecte-toi ou crée un compte avec un pseudo et un mot de passe. Ta ferme est liée à ce
          compte, accessible depuis n&rsquo;importe quel appareil.
        </p>
        <input
          type="text"
          placeholder="Ton pseudo"
          maxLength={16}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="password"
          placeholder="Mot de passe (4 caractères min.)"
          maxLength={40}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit('login')}
        />
        <div className="auth-error">{error}</div>
        <button className="full-btn" disabled={busy} onClick={() => submit('login')}>
          Se connecter
        </button>
        <button
          className="full-btn"
          disabled={busy}
          style={{ marginTop: 8, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--paper-line)' }}
          onClick={() => submit('register')}
        >
          Créer un compte avec ce pseudo
        </button>
        <p className="auth-note">
          Authentification simplifiée pour jouer entre amis — ne réutilise pas un mot de passe
          important ailleurs.
        </p>
      </div>
    </div>
  );
}

function errorMessage(code) {
  switch (code) {
    case 'invalid_username':
      return 'Pseudo invalide (3 à 16 caractères, lettres/chiffres/espaces/-/_).';
    case 'password_too_short':
      return 'Le mot de passe doit faire au moins 4 caractères.';
    case 'username_taken':
      return 'Ce pseudo existe déjà — si c\'est toi, connecte-toi avec ton mot de passe.';
    case 'not_found':
      return 'Aucun compte avec ce pseudo. Crée-en un.';
    case 'wrong_password':
      return 'Mot de passe incorrect.';
    default:
      return 'Une erreur est survenue, réessaie.';
  }
}

function Game({ username, onLoggedOut }) {
  const [state, setState] = useState(null); // { money, wheat, plots, upgrades }
  const [bestScore, setBestScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [log, setLog] = useState([]);
  const [resetArmed, setResetArmed] = useState(false);
  const dirtyRef = useRef(false);
  const stateRef = useRef(null);
  stateRef.current = state;

  const pushLog = useCallback((msg) => {
    setLog((prev) => [msg, ...prev].slice(0, 8));
  }, []);

  // Load the account's save on mount.
  useEffect(() => {
    fetch('/api/game/state')
      .then((r) => r.json())
      .then((data) => {
        if (data.state) {
          setState(data.state);
          setBestScore(data.bestScore || 0);
        } else {
          setState(initialState());
        }
      });
  }, []);

  const refreshLeaderboard = useCallback(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data) => setLeaderboard(data.entries || []));
  }, []);

  useEffect(() => {
    refreshLeaderboard();
  }, [refreshLeaderboard]);

  // Growth tick.
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => {
        if (!prev) return prev;
        const gt = growTimeSeconds(prev) * 1000;
        let changed = false;
        const plots = prev.plots.map((p) => {
          if (p.state === 'growing' && Date.now() - p.plantedAt >= gt) {
            changed = true;
            return { ...p, state: 'ready' };
          }
          return p;
        });
        if (!changed) return prev;
        return { ...prev, plots };
      });
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Autosave loop.
  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current && stateRef.current) {
        dirtyRef.current = false;
        const money = Math.round(stateRef.current.money);
        const newBest = Math.max(bestScore, money);
        if (newBest !== bestScore) setBestScore(newBest);
        fetch('/api/game/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: stateRef.current, bestScore: newBest }),
        }).then(() => refreshLeaderboard());
      }
    }, 4000);
    return () => clearInterval(id);
  }, [bestScore, refreshLeaderboard]);

  function markDirty() {
    dirtyRef.current = true;
  }

  function buyPlot(i) {
    setState((prev) => {
      if (!prev || prev.plots[i].state !== 'locked') return prev;
      const cost = plotCost(prev.plots);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour une nouvelle parcelle (${cost}p).`);
        return prev;
      }
      const plots = prev.plots.slice();
      plots[i] = { ...plots[i], state: 'empty' };
      pushLog(`Parcelle achetée pour ${cost}p.`);
      markDirty();
      return { ...prev, money: prev.money - cost, plots };
    });
  }

  function plant(i) {
    setState((prev) => {
      if (!prev || prev.plots[i].state !== 'empty') return prev;
      if (prev.money < SEED_COST) {
        pushLog(`Pas assez de trésorerie pour semer (${SEED_COST}p).`);
        return prev;
      }
      const plots = prev.plots.slice();
      plots[i] = { state: 'growing', plantedAt: Date.now() };
      markDirty();
      return { ...prev, money: prev.money - SEED_COST, plots };
    });
  }

  function harvest(i) {
    setState((prev) => {
      if (!prev || prev.plots[i].state !== 'ready') return prev;
      const amount = yieldAmount(prev);
      const cap = siloCap(prev);
      const space = cap - prev.wheat;
      const added = Math.min(amount, Math.max(0, space));
      if (added < amount) pushLog(`Silo plein ! ${amount - added} unités de blé perdues.`);
      const plots = prev.plots.slice();
      plots[i] = { state: 'empty', plantedAt: null };
      markDirty();
      return { ...prev, wheat: prev.wheat + added, plots };
    });
  }

  function sell() {
    setState((prev) => {
      if (!prev || prev.wheat <= 0) return prev;
      const total = Math.round(prev.wheat * SELL_PRICE);
      pushLog(`Vente de ${prev.wheat} unités de blé pour ${total}p.`);
      markDirty();
      return { ...prev, money: prev.money + total, wheat: 0 };
    });
  }

  function buyUpgrade(key) {
    setState((prev) => {
      if (!prev) return prev;
      const u = prev.upgrades[key];
      const def = UPGRADE_DEFS[key];
      if (u.level >= def.max) return prev;
      const cost = upgradeCost(key, u.level);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour "${def.name}" (${cost}p).`);
        return prev;
      }
      pushLog(`Investissement : ${def.name} (niveau ${u.level + 1}).`);
      markDirty();
      return {
        ...prev,
        money: prev.money - cost,
        upgrades: { ...prev.upgrades, [key]: { level: u.level + 1 } },
      };
    });
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLoggedOut();
  }

  function handleReset() {
    if (!resetArmed) {
      setResetArmed(true);
      setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    setResetArmed(false);
    setState(initialState());
    setBestScore(0);
    setLog([]);
    pushLog('Partie réinitialisée.');
    markDirty();
  }

  if (!state) return null;

  const owned = ownedCount(state.plots);
  const nextPlotCost = plotCost(state.plots);

  return (
    <>
      <div className="topbar">
        <h1>Wheat2Wealth</h1>
        <div className="top-right">
          <span>
            Joueur : <b>{username}</b>
          </span>
          <button className="link-btn" onClick={handleLogout}>
            changer de compte
          </button>
          <button className={`link-btn ${resetArmed ? 'armed' : ''}`} onClick={handleReset}>
            {resetArmed ? 'Confirmer ? Tout sera perdu' : 'réinitialiser ma partie'}
          </button>
          <div className="wallet">
            Trésorerie : <span>{Math.round(state.money).toLocaleString()}</span> p
          </div>
        </div>
      </div>

      <div className="layout">
        <div className="field-wrap">
          <div className="field-caption">
            Clique une parcelle libre pour l&rsquo;acheter, une parcelle semée pour la récolter.
          </div>
          <div className="field">
            {state.plots.map((p, i) => (
              <Plot key={i} plot={p} cost={nextPlotCost} money={state.money}
                growTime={growTimeSeconds(state)}
                onClick={() => {
                  if (p.state === 'locked') buyPlot(i);
                  else if (p.state === 'empty') plant(i);
                  else if (p.state === 'ready') harvest(i);
                }}
              />
            ))}
          </div>
        </div>

        <div className="ledger">
          <div className="ledger-section">
            <h2>Parcelles</h2>
            <div className="row"><span>Prochaine parcelle</span><span>{nextPlotCost} p</span></div>
            <div className="row"><span>Semer une parcelle libre</span><span>{SEED_COST} p</span></div>
            <div className="row muted"><span>Temps de pousse</span><span>{growTimeSeconds(state).toFixed(1)} s</span></div>
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Silo</h2>
            <div className="row"><span>Blé stocké</span><span>{state.wheat} / {siloCap(state)}</span></div>
            <div className="row"><span>Prix de vente (fixe)</span><span>{SELL_PRICE.toFixed(1)} p</span></div>
            <button className="full-btn" disabled={state.wheat <= 0} onClick={sell}>
              VENTE À LA CRIÉE {Math.round(state.wheat * SELL_PRICE)}p
            </button>
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Investissements</h2>
            {Object.keys(UPGRADE_DEFS).map((key) => {
              const def = UPGRADE_DEFS[key];
              const u = state.upgrades[key];
              const maxed = u.level >= def.max;
              const cost = upgradeCost(key, u.level);
              return (
                <div className="upgrade" key={key}>
                  <div className="upgrade-top">
                    <span className="upgrade-name">{def.name}</span>
                    <span className="upgrade-level">Niv. {u.level}{maxed ? ' (max)' : `/${def.max}`}</span>
                  </div>
                  <div className="upgrade-desc">{def.desc}</div>
                  <button className="full-btn" disabled={maxed} onClick={() => buyUpgrade(key)}>
                    {maxed ? 'Investissement maximal' : `Investir — ${cost}p`}
                  </button>
                </div>
              );
            })}
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Classement</h2>
            <ul className="leaderboard">
              {leaderboard.length === 0 && <li className="muted">Aucun score enregistré pour l&rsquo;instant.</li>}
              {leaderboard.map((entry, idx) => (
                <li key={entry.username} className={entry.username === username ? 'me' : ''}>
                  <span><span className="rank">#{idx + 1}</span>{entry.username}</span>
                  <span>{Math.round(entry.bestScore).toLocaleString()} p</span>
                </li>
              ))}
            </ul>
            <button className="full-btn" onClick={refreshLeaderboard}>Actualiser le classement</button>
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Registre</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 110, overflowY: 'auto' }}>
              {log.map((m, i) => (
                <li key={i} style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', padding: '3px 0' }}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function Plot({ plot, cost, money, growTime, onClick }) {
  if (plot.state === 'locked') {
    const affordable = money >= cost;
    return (
      <div className={`plot locked ${affordable ? 'affordable' : ''}`} onClick={onClick}>
        🔒
        <span className="plot-price">{cost}p</span>
      </div>
    );
  }
  if (plot.state === 'empty') {
    return (
      <div className="plot empty" onClick={onClick}>
        ＋
        <span className="plot-price">{SEED_COST}p</span>
      </div>
    );
  }
  if (plot.state === 'growing') {
    const progress = Math.min(1, (Date.now() - plot.plantedAt) / (growTime * 1000));
    return (
      <div className="plot growing">
        {progress < 0.5 ? '🌱' : '🌿'}
        <span className="plot-bar"><span className="plot-bar-fill" style={{ width: `${progress * 100}%` }} /></span>
      </div>
    );
  }
  return (
    <div className="plot ready" onClick={onClick}>
      🌾
    </div>
  );
}

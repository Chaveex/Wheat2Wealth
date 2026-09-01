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
  ouvrierInterval,
  semeurInterval,
  findNextIndex,
  normalizeState,
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
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const dirtyRef = useRef(false);
  const stateRef = useRef(null);
  stateRef.current = state;

  const pushLog = useCallback((msg) => {
    setLog((prev) => [msg, ...prev].slice(0, 8));
  }, []);

  // Load the account's save on mount. Every branch here is explicit on
  // purpose: silently falling back to a fresh game on *any* fetch problem
  // (a dropped session, a Supabase misconfiguration, a network hiccup) is
  // exactly what made reloads look like "my progress isn't saved" before.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      let res;
      try {
        res = await fetch('/api/game/state');
      } catch {
        if (!cancelled) setLoadError('Impossible de joindre le serveur. Vérifie ta connexion et recharge la page.');
        return;
      }
      if (res.status === 401) {
        if (!cancelled) { setLoadError(null); onLoggedOut(); }
        return;
      }
      if (res.status === 404) {
        // Genuinely no save yet for this account: start fresh and persist
        // that starting point immediately, so the next reload finds it.
        const fresh = initialState();
        if (cancelled) return;
        setState(fresh);
        setBestScore(0);
        try {
          const saveRes = await fetch('/api/game/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: fresh, bestScore: 0 }),
          });
          if (!saveRes.ok) throw new Error('save failed');
        } catch {
          if (!cancelled) setLoadError("La partie n'a pas pu être créée sur le serveur. Recharge la page pour réessayer.");
        }
        return;
      }
      if (!res.ok) {
        if (!cancelled) setLoadError(`Le serveur a répondu une erreur (${res.status}). Ta progression n'a pas été perdue, mais elle n'a pas pu être chargée — réessaie de recharger la page.`);
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setState(normalizeState(data.state));
      setBestScore(data.bestScore || 0);
    }
    load();
    return () => { cancelled = true; };
  }, [onLoggedOut]);

  const refreshLeaderboard = useCallback(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data) => setLeaderboard(data.entries || []));
  }, []);

  useEffect(() => {
    refreshLeaderboard();
  }, [refreshLeaderboard]);

  // Growth tick + automation (ouvrier agricole / semeur automatique).
  const harvestCursorRef = useRef(-1);
  const sowCursorRef = useRef(-1);
  const lastHarvestRef = useRef(0);
  const lastSowRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => {
        if (!prev) return prev;
        const gt = growTimeSeconds(prev) * 1000;
        let plots = prev.plots;
        let wheat = prev.wheat;
        let money = prev.money;
        let changed = false;
        let logMsg = null;

        const mapped = plots.map((p) => {
          if (p.state === 'growing' && Date.now() - p.plantedAt >= gt) {
            changed = true;
            return { ...p, state: 'ready' };
          }
          return p;
        });
        if (changed) plots = mapped;

        const hInterval = ouvrierInterval(prev);
        if (hInterval !== null) {
          if (!lastHarvestRef.current) lastHarvestRef.current = Date.now();
          if (Date.now() - lastHarvestRef.current >= hInterval * 1000) {
            const idx = findNextIndex(plots, harvestCursorRef.current, (p) => p.state === 'ready');
            if (idx !== -1) {
              const amount = yieldAmount(prev);
              const cap = siloCap(prev);
              const space = cap - wheat;
              const added = Math.min(amount, Math.max(0, space));
              if (plots === prev.plots) plots = plots.slice();
              plots[idx] = { state: 'empty', plantedAt: null };
              wheat += added;
              harvestCursorRef.current = idx;
              changed = true;
            }
            lastHarvestRef.current = Date.now();
          }
        }

        const sInterval = semeurInterval(prev);
        if (sInterval !== null) {
          if (!lastSowRef.current) lastSowRef.current = Date.now();
          if (Date.now() - lastSowRef.current >= sInterval * 1000) {
            const idx = findNextIndex(plots, sowCursorRef.current, (p) => p.state === 'empty');
            if (idx !== -1 && money >= SEED_COST) {
              if (plots === prev.plots) plots = plots.slice();
              plots[idx] = { state: 'growing', plantedAt: Date.now() };
              money -= SEED_COST;
              sowCursorRef.current = idx;
              changed = true;
              dirtyRef.current = true;
            }
            lastSowRef.current = Date.now();
          }
        }

        if (!changed) return prev;
        return { ...prev, plots, wheat, money };
      });
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Autosave loop.
  useEffect(() => {
    const id = setInterval(async () => {
      if (dirtyRef.current && stateRef.current) {
        dirtyRef.current = false;
        const money = Math.round(stateRef.current.money);
        const newBest = Math.max(bestScore, money);
        if (newBest !== bestScore) setBestScore(newBest);
        try {
          const res = await fetch('/api/game/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: stateRef.current, bestScore: newBest }),
          });
          if (!res.ok) {
            dirtyRef.current = true; // retry on the next tick instead of losing the change
            setSaveError(`La sauvegarde a échoué (erreur ${res.status}). Nouvelle tentative dans quelques secondes — ne ferme pas cette page.`);
            return;
          }
          setSaveError(null);
          refreshLeaderboard();
        } catch {
          dirtyRef.current = true;
          setSaveError('Impossible de joindre le serveur pour sauvegarder. Nouvelle tentative dans quelques secondes — ne ferme pas cette page.');
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [bestScore, refreshLeaderboard]);

  function markDirty() {
    dirtyRef.current = true;
  }

  // Best-effort save if the tab is closed/reloaded before the next autosave
  // tick — keepalive lets the request survive the page unloading.
  useEffect(() => {
    function handleUnload() {
      if (dirtyRef.current && stateRef.current) {
        const money = Math.round(stateRef.current.money);
        const newBest = Math.max(bestScore, money);
        fetch('/api/game/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: stateRef.current, bestScore: newBest }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [bestScore]);

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

  if (!state) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Wheat2Wealth</h1>
          {loadError ? (
            <>
              <p style={{ color: 'var(--alert)' }}>{loadError}</p>
              <button className="full-btn" onClick={() => window.location.reload()}>Recharger la page</button>
            </>
          ) : (
            <p>Chargement de ta ferme…</p>
          )}
        </div>
      </div>
    );
  }

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

      {saveError && (
        <div style={{ background: 'var(--alert)', color: '#fff', padding: '8px 20px', fontSize: '0.8rem', textAlign: 'center' }}>
          ⚠ {saveError}
        </div>
      )}

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
              let desc = def.desc;
              if (key === 'ouvrier') {
                desc = u.level <= 0
                  ? "Aucun ouvrier pour l'instant : il faut récolter les parcelles prêtes toi-même."
                  : `Récolte une parcelle prête toutes les ${ouvrierInterval(state).toFixed(1)} s.`;
              } else if (key === 'semeur') {
                desc = u.level <= 0
                  ? "Aucun semeur pour l'instant : les parcelles vides restent vides tant que tu ne sèmes pas toi-même."
                  : `Sème une parcelle vide toutes les ${semeurInterval(state).toFixed(1)} s.`;
              }
              return (
                <div className="upgrade" key={key}>
                  <div className="upgrade-top">
                    <span className="upgrade-name">{def.name}</span>
                    <span className="upgrade-level">Niv. {u.level}{maxed ? ' (max)' : `/${def.max}`}</span>
                  </div>
                  <div className="upgrade-desc">{desc}</div>
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

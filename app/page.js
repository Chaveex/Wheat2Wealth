'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
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
  meets4LinesRequirement,
  get2x2Block,
  moissonneusePenalty,
  semoirMecaFailChance,
  courtierTax,
  COURTIER_THRESHOLD,
  computeResaleValue,
  choiceTierCount,
  choiceTierCost,
  harvesterSprite,
  seederSprite,
  formatDuration,
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
  const [harvestMode, setHarvestMode] = useState('manual');
  const [sowMode, setSowMode] = useState('manual');
  const [courtierActive, setCourtierActive] = useState(true);
  const dirtyRef = useRef(false);
  const stateRef = useRef(null);
  stateRef.current = state;
  const courtierActiveRef = useRef(true);
  courtierActiveRef.current = courtierActive;

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

  // Purely visual re-render trigger: playtime and the live p/s indicator
  // change every second even when nothing in `state` itself changes.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Growth tick + automation (ouvrier agricole / semeur automatique).
  const harvestCursorRef = useRef(-1);
  const sowCursorRef = useRef(-1);
  const lastHarvestRef = useRef(0);
  const lastSowRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => {
        if (!prev || prev.gamePhase !== 'playing') return prev;
        const gt = growTimeSeconds(prev) * 1000;
        let plots = prev.plots;
        let wheat = prev.wheat;
        let money = prev.money;
        let changed = false;
        let statHarvested = 0;
        let statLost = 0;
        let statSpent = 0;
        let statEarned = 0;
        let statSold = 0;
        let statSales = 0;
        let newSale = null;

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
              statHarvested += added;
              statLost += amount - added;
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
              statSpent += SEED_COST;
              sowCursorRef.current = idx;
              changed = true;
              dirtyRef.current = true;
            }
            lastSowRef.current = Date.now();
          }
        }

        if (courtierActiveRef.current && prev.upgrades.courtier.level > 0) {
          const cap = siloCap(prev);
          if (cap > 0 && wheat >= cap * COURTIER_THRESHOLD) {
            const gross = Math.round(wheat * SELL_PRICE);
            const tax = courtierTax(prev);
            const total = Math.round(gross * (1 - tax));
            pushLog(`Vente automatique (courtier) de ${wheat} unités de blé pour ${total}p (taxe ${Math.round(tax * 100)}%).`);
            statEarned += total;
            statSold += wheat;
            statSales += 1;
            newSale = { t: Date.now(), amount: total };
            money += total;
            wheat = 0;
            changed = true;
            dirtyRef.current = true;
          }
        }

        if (!changed) return prev;
        const stats = { ...prev.stats };
        stats.totalWheatHarvested += statHarvested;
        stats.totalWheatLost += statLost;
        stats.totalSpent += statSpent;
        stats.totalEarned += statEarned;
        stats.totalWheatSold += statSold;
        stats.salesCount += statSales;
        if (newSale) stats.recentSales = [...stats.recentSales, newSale];
        return { ...prev, plots, wheat, money, stats };
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
      const cost = plotCost(prev.plots, prev);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour une nouvelle parcelle (${cost}p).`);
        return prev;
      }
      const plots = prev.plots.slice();
      plots[i] = { ...plots[i], state: 'empty' };
      pushLog(`Parcelle achetée pour ${cost}p.`);
      markDirty();
      return {
        ...prev,
        money: prev.money - cost,
        plots,
        plotsInvested: (prev.plotsInvested || 0) + cost,
        stats: { ...prev.stats, totalSpent: prev.stats.totalSpent + cost },
      };
    });
  }

  function plant(i) {
    setState((prev) => {
      if (!prev) return prev;
      const useCombine = sowMode === 'combine' && prev.upgrades.semoirMeca.level > 0;
      const indices = useCombine ? get2x2Block(i, prev.farmCols, prev.farmRows) : [i];
      const plots = prev.plots.slice();
      let money = prev.money;
      let spent = 0;
      let attempted = false;
      indices.forEach((idx) => {
        if (plots[idx].state !== 'empty') return;
        if (money < SEED_COST) return;
        attempted = true;
        money -= SEED_COST;
        spent += SEED_COST;
        if (useCombine && Math.random() < semoirMecaFailChance(prev)) {
          pushLog("Semis raté : la graine n'a pas pris (semoir mécanique).");
        } else {
          plots[idx] = { state: 'growing', plantedAt: Date.now() };
        }
      });
      if (!attempted) {
        pushLog(`Pas assez de trésorerie pour semer (${SEED_COST}p).`);
        return prev;
      }
      markDirty();
      return { ...prev, money, plots, stats: { ...prev.stats, totalSpent: prev.stats.totalSpent + spent } };
    });
  }

  function harvest(i) {
    setState((prev) => {
      if (!prev) return prev;
      const useCombine = harvestMode === 'combine' && prev.upgrades.moissonneuse.level > 0;
      const indices = useCombine ? get2x2Block(i, prev.farmCols, prev.farmRows) : [i];
      const plots = prev.plots.slice();
      let wheat = prev.wheat;
      let harvested = 0;
      let lost = 0;
      let touched = false;
      indices.forEach((idx) => {
        if (plots[idx].state !== 'ready') return;
        touched = true;
        let amount = yieldAmount(prev);
        if (useCombine) amount = Math.max(0, Math.round(amount * (1 - moissonneusePenalty(prev))));
        const cap = siloCap(prev);
        const space = cap - wheat;
        const added = Math.min(amount, Math.max(0, space));
        if (added < amount) {
          pushLog(`Silo plein ! ${amount - added} unités de blé perdues.`);
          lost += amount - added;
        }
        wheat += added;
        harvested += added;
        plots[idx] = { state: 'empty', plantedAt: null };
      });
      if (!touched) return prev;
      markDirty();
      return {
        ...prev,
        wheat,
        plots,
        stats: {
          ...prev.stats,
          totalWheatHarvested: prev.stats.totalWheatHarvested + harvested,
          totalWheatLost: prev.stats.totalWheatLost + lost,
        },
      };
    });
  }

  function sell() {
    setState((prev) => {
      if (!prev || prev.wheat <= 0) return prev;
      const total = Math.round(prev.wheat * SELL_PRICE);
      pushLog(`Vente de ${prev.wheat} unités de blé pour ${total}p.`);
      markDirty();
      return {
        ...prev,
        money: prev.money + total,
        wheat: 0,
        stats: {
          ...prev.stats,
          totalEarned: prev.stats.totalEarned + total,
          totalWheatSold: prev.stats.totalWheatSold + prev.wheat,
          salesCount: prev.stats.salesCount + 1,
          recentSales: [...prev.stats.recentSales, { t: Date.now(), amount: total }],
        },
      };
    });
  }

  function buyUpgrade(key) {
    setState((prev) => {
      if (!prev) return prev;
      const u = prev.upgrades[key];
      const def = UPGRADE_DEFS[key];
      if (u.level >= def.max) return prev;
      if ((key === 'moissonneuse' || key === 'semoirMeca') && u.level === 0 && !meets4LinesRequirement(prev.plots, prev.farmCols, prev.farmRows)) {
        pushLog(`${def.name} verrouillé(e) : débloque d'abord 4 lignes ou 4 colonnes complètes de parcelles.`);
        return prev;
      }
      const cost = upgradeCost(key, u.level, prev);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour "${def.name}" (${cost}p).`);
        return prev;
      }
      pushLog(`Investissement : ${def.name} (niveau ${u.level + 1}).`);
      markDirty();
      return {
        ...prev,
        money: prev.money - cost,
        upgrades: { ...prev.upgrades, [key]: { level: u.level + 1, totalInvested: (u.totalInvested || 0) + cost } },
        stats: { ...prev.stats, totalSpent: prev.stats.totalSpent + cost },
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

  const [sellFarmArmed, setSellFarmArmed] = useState(false);

  function handleSellFarm() {
    if (!sellFarmArmed) {
      setSellFarmArmed(true);
      setTimeout(() => setSellFarmArmed(false), 4000);
      return;
    }
    setSellFarmArmed(false);
    setState((prev) => {
      if (!prev) return prev;
      const value = computeResaleValue(prev);
      const upgrades = {};
      Object.keys(prev.upgrades).forEach((key) => { upgrades[key] = { level: 0, totalInvested: 0 }; });
      pushLog(`Exploitation revendue pour ${value}p. Génération ${prev.generation} : à toi de choisir ta nouvelle exploitation.`);
      markDirty();
      return {
        ...prev,
        money: prev.money + value,
        wheat: 0,
        plotsInvested: 0,
        upgrades,
        generation: prev.generation + 1,
        gamePhase: 'choosing',
      };
    });
    setHarvestMode('manual');
    setSowMode('manual');
  }

  function chooseFarm(tier) {
    setState((prev) => {
      if (!prev) return prev;
      const cost = choiceTierCost(tier, prev);
      if (prev.money < cost) return prev;
      const newCols = prev.farmCols + tier;
      const newRows = prev.farmRows + tier;
      pushLog(`Nouvelle exploitation choisie : ${newCols} × ${newRows} parcelles.`);
      markDirty();
      return {
        ...prev,
        money: prev.money - cost,
        farmCols: newCols,
        farmRows: newRows,
        plots: freshPlots(newCols, newRows),
        gamePhase: 'playing',
      };
    });
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
  const nextPlotCost = plotCost(state.plots, state);
  const recentSales = state.stats.recentSales.filter((e) => Date.now() - e.t <= 60000);
  const perSecond = recentSales.reduce((sum, e) => sum + e.amount, 0) / 60;
  const elapsedMs = Date.now() - state.stats.startedAt;
  const elapsedSec = Math.max(elapsedMs / 1000, 1);
  const totalProduced = state.stats.totalWheatHarvested + state.stats.totalWheatLost;
  const wastePct = totalProduced > 0 ? (state.stats.totalWheatLost / totalProduced) * 100 : 0;
  const costPerUnit = state.stats.totalWheatHarvested > 0 ? state.stats.totalSpent / state.stats.totalWheatHarvested : 0;
  const netProfit = state.stats.totalEarned - state.stats.totalSpent;
  const idealCadence = owned > 0 ? growTimeSeconds(state) / owned : growTimeSeconds(state);
  const sowerInterval = semeurInterval(state);
  const harvestInterval = ouvrierInterval(state);

  return (
    <>
      <div className="topbar">
        <h1><img src="/sprites/logo.webp" alt="Wheat2Wealth" style={{ width: 126.23, height: 44, display: 'block' }} /></h1>
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
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', border: '1px solid rgba(138,160,102,0.4)', borderRadius: 3, padding: '4px 10px' }}>
            {perSecond.toFixed(2)} p/s
          </div>
        </div>
      </div>

      {saveError && (
        <div style={{ background: 'var(--alert)', color: '#fff', padding: '8px 20px', fontSize: '0.8rem', textAlign: 'center' }}>
          ⚠ {saveError}
        </div>
      )}

      <div className="layout">
        {state.gamePhase === 'choosing' ? (
          <FarmChoiceScreen state={state} onChoose={chooseFarm} />
        ) : (
          <div className="field-wrap">
            <div className="field-caption">
              Clique une parcelle libre pour l&rsquo;acheter, une parcelle semée pour la récolter.
            </div>
            {state.upgrades.moissonneuse.level > 0 && (
              <ModeToggle
                label="Mode de récolte :"
                value={harvestMode}
                onChange={setHarvestMode}
                combineLabel={`Moissonneuse (2×2, -${Math.round(moissonneusePenalty(state) * 100)}%)`}
                combineIcon={harvesterSprite(state.upgrades.moissonneuse.level)}
              />
            )}
            {state.upgrades.semoirMeca.level > 0 && (
              <ModeToggle
                label="Mode de semis :"
                value={sowMode}
                onChange={setSowMode}
                combineLabel={`Semoir (2×2, ${Math.round(semoirMecaFailChance(state) * 100)}% d'échec)`}
                combineIcon={seederSprite(state.upgrades.semoirMeca.level)}
              />
            )}
            <div className="field" style={{ gridTemplateColumns: `repeat(${state.farmCols}, 1fr)` }}>
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
        )}

        <div className="ledger panel-col-left">
          <div className="ledger-section">
            <h2>Parcelles</h2>
            <div className="row"><span>Prochaine parcelle</span><span>{nextPlotCost} p</span></div>
            <div className="row"><span>Semer une parcelle libre</span><span>{SEED_COST} p</span></div>
            <div className="row muted"><span>Temps de pousse</span><span>{growTimeSeconds(state).toFixed(1)} s</span></div>
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Exploitation</h2>
            <div className="row"><span>Génération</span><span>{state.generation}</span></div>
            <div className="row"><span>Taille du terrain</span><span>{state.farmCols} × {state.farmRows}</span></div>
            <button
              className={`full-btn ${sellFarmArmed ? 'armed' : ''}`}
              disabled={state.gamePhase !== 'playing'}
              onClick={handleSellFarm}
              style={sellFarmArmed ? { background: 'var(--alert)', color: '#fff' } : undefined}
            >
              {sellFarmArmed
                ? `Confirmer la vente ? (${computeResaleValue(state)}p)`
                : `Revente de l'exploitation (${computeResaleValue(state)}p)`}
            </button>
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Silo</h2>
            <div className="row"><span>Blé stocké</span><span>{state.wheat} / {siloCap(state)}</span></div>
            <div className="row"><span>Prix de vente (fixe)</span><span>{SELL_PRICE.toFixed(1)} p</span></div>
            <button
              className="full-btn"
              disabled={state.wheat <= 0}
              onClick={sell}
              style={{
                backgroundImage: `url(${state.wheat > 0 ? '/sprites/sell-on.webp' : '/sprites/sell-off.webp'})`,
                backgroundSize: '100% 100%',
                backgroundColor: 'transparent',
                border: 'none',
                height: 56,
                fontFamily: "'Courier New', monospace",
                fontWeight: state.wheat > 0 ? 700 : 600,
                color: state.wheat > 0 ? '#2B1D0C' : '#736f60',
              }}
            >
              VENTE À LA CRIÉE {Math.round(state.wheat * SELL_PRICE)}p
            </button>
            {state.upgrades.courtier.level > 0 && (
              <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
                <span>Courtier automatique :</span>
                <button
                  onClick={() => setCourtierActive((v) => !v)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}
                  aria-label={courtierActive ? 'Activé' : 'Désactivé'}
                  title={courtierActive ? 'Activé' : 'Désactivé'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={courtierActive ? '/sprites/toggle-on.webp' : '/sprites/toggle-off.webp'}
                    alt={courtierActive ? 'Activé' : 'Désactivé'}
                    style={{ height: 26, width: 'auto', imageRendering: 'pixelated', display: 'block' }}
                  />
                </button>
              </div>
            )}
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Efficacité de la ferme</h2>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Parcelles en exploitation</div>
                <div className="stat-value">{owned}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cadence idéale (plein régime)</div>
                <div className="stat-value">1 toutes les {idealCadence.toFixed(2)}s</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cadence du semeur</div>
                <div className={`stat-value ${sowerInterval === null ? '' : sowerInterval <= idealCadence ? 'ok' : 'slow'}`}>
                  {sowerInterval === null ? 'inactif' : `1 toutes les ${sowerInterval.toFixed(1)}s`}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cadence de l&rsquo;ouvrier</div>
                <div className={`stat-value ${harvestInterval === null ? '' : harvestInterval <= idealCadence ? 'ok' : 'slow'}`}>
                  {harvestInterval === null ? 'inactif' : `1 toutes les ${harvestInterval.toFixed(1)}s`}
                </div>
              </div>
            </div>
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

        <div className="ledger panel-col-right">
          <div className="ledger-section">
            <h2>Investissements</h2>
            {Object.keys(UPGRADE_DEFS).map((key) => {
              const def = UPGRADE_DEFS[key];
              const u = state.upgrades[key];
              const maxed = u.level >= def.max;
              const cost = upgradeCost(key, u.level, state);
              let desc = def.desc;
              if (key === 'ouvrier') {
                desc = u.level <= 0
                  ? "Aucun ouvrier pour l'instant : il faut récolter les parcelles prêtes toi-même."
                  : `Récolte une parcelle prête toutes les ${ouvrierInterval(state).toFixed(1)} s.`;
              } else if (key === 'semeur') {
                desc = u.level <= 0
                  ? "Aucun semeur pour l'instant : les parcelles vides restent vides tant que tu ne sèmes pas toi-même."
                  : `Sème une parcelle vide toutes les ${semeurInterval(state).toFixed(1)} s.`;
              } else if (key === 'moissonneuse') {
                desc = u.level <= 0
                  ? "Débloque d'abord 4 lignes ou 4 colonnes complètes de parcelles achetées pour pouvoir l'acheter."
                  : `Permet de récolter en carré de 2×2 (à toi de choisir le mode). Pénalité de rendement actuelle en mode moissonneuse : -${Math.round(moissonneusePenalty(state) * 100)}%.`;
              } else if (key === 'semoirMeca') {
                desc = u.level <= 0
                  ? "Débloque d'abord 4 lignes ou 4 colonnes complètes de parcelles achetées pour pouvoir l'acheter."
                  : `Permet de semer en carré de 2×2 (à toi de choisir le mode). Risque actuel qu'une parcelle ne prenne pas : ${Math.round(semoirMecaFailChance(state) * 100)}%.`;
              } else if (key === 'courtier') {
                desc = u.level <= 0
                  ? 'Vend automatiquement le blé quand le silo est presque plein, contre une taxe.'
                  : `Vend automatiquement tout le blé dès que le silo atteint ${Math.round(COURTIER_THRESHOLD * 100)}% de sa capacité. Taxe actuelle : ${Math.round(courtierTax(state) * 100)}%. Vendre à la main reste plus rentable (jamais de taxe).`;
              }
              const gated = (key === 'moissonneuse' || key === 'semoirMeca') && u.level === 0 && !meets4LinesRequirement(state.plots, state.farmCols, state.farmRows);
              const afford = state.money >= cost;
              let icon = null;
              if (key === 'moissonneuse') icon = harvesterSprite(u.level);
              else if (key === 'semoirMeca') icon = seederSprite(u.level);
              return (
                <div className="upgrade" key={key}>
                  <div className="upgrade-top">
                    <span className="upgrade-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={icon} alt="" style={{ height: '1.3em', width: 'auto', imageRendering: 'pixelated' }} />
                      )}
                      {def.name}
                    </span>
                    <span className="upgrade-level">Niv. {u.level}{maxed ? ' (max)' : `/${def.max}`}</span>
                  </div>
                  <div className="upgrade-desc">{desc}</div>
                  <InvestButton maxed={maxed} afford={afford && !gated} cost={cost} onClick={() => buyUpgrade(key)} />
                </div>
              );
            })}
          </div>
          <hr />
          <div className="ledger-section">
            <h2>Statistiques</h2>
            <p className="field-caption" style={{ color: 'var(--ink-soft)' }}>
              Les chiffres bruts pour optimiser ta stratégie — tout ce qui compte pour battre les
              autres joueurs à temps de jeu égal.
            </p>
            <div className="stat-grid stats-wide">
              <div className="stat-card">
                <div className="stat-label">Temps de jeu</div>
                <div className="stat-value">{formatDuration(elapsedMs)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Revenu total (ventes)</div>
                <div className="stat-value">{Math.round(state.stats.totalEarned).toLocaleString()} p</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Dépenses totales</div>
                <div className="stat-value">{Math.round(state.stats.totalSpent).toLocaleString()} p</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Profit net</div>
                <div className={`stat-value ${netProfit >= 0 ? 'ok' : 'slow'}`}>
                  {netProfit >= 0 ? '+' : ''}{Math.round(netProfit).toLocaleString()} p
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Nombre de ventes</div>
                <div className="stat-value">{state.stats.salesCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Blé vendu (total)</div>
                <div className="stat-value">{state.stats.totalWheatSold}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Blé produit (total)</div>
                <div className="stat-value">{totalProduced}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Blé perdu (silo plein)</div>
                <div className={`stat-value ${state.stats.totalWheatLost > 0 ? 'slow' : 'ok'}`}>
                  {state.stats.totalWheatLost}{totalProduced > 0 ? ` (${wastePct.toFixed(1)}%)` : ''}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Revenu moyen depuis le début</div>
                <div className="stat-value">{(state.stats.totalEarned / elapsedSec).toFixed(2)} p/s</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cadence actuelle (60s)</div>
                <div className="stat-value">{perSecond.toFixed(2)} p/s</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Coût moyen / unité de blé</div>
                <div className="stat-value">{state.stats.totalWheatHarvested > 0 ? `${costPerUnit.toFixed(2)} p/unité` : '—'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Marge nette / unité</div>
                <div className={`stat-value ${state.stats.totalWheatHarvested > 0 ? (SELL_PRICE - costPerUnit >= 0 ? 'ok' : 'slow') : ''}`}>
                  {state.stats.totalWheatHarvested > 0
                    ? `${SELL_PRICE - costPerUnit >= 0 ? '+' : ''}${(SELL_PRICE - costPerUnit).toFixed(2)} p/unité`
                    : '—'}
                </div>
              </div>
            </div>
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
        </div>
      </div>
    </>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '1.5rem', height: '1.5rem' }}>
      <path d="M7 10V8a5 5 0 0110 0v2h.5A1.5 1.5 0 0119 11.5v9a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20.5v-9A1.5 1.5 0 016.5 10H7zm2 0h6V8a3 3 0 00-6 0v2zm3 5a1.5 1.5 0 00-.75 2.8V19a.75.75 0 001.5 0v-1.2A1.5 1.5 0 0012 15z" />
    </svg>
  );
}

function Plot({ plot, cost, money, growTime, onClick }) {
  if (plot.state === 'locked') {
    const affordable = money >= cost;
    return (
      <div className={`plot locked ${affordable ? 'affordable' : ''}`} onClick={onClick}>
        <LockIcon />
        <span className="plot-price">{cost}p</span>
      </div>
    );
  }
  if (plot.state === 'empty') {
    return (
      <div className="plot empty" style={{ backgroundImage: 'url(/sprites/field-soil.webp)' }} onClick={onClick}>
        <span className="plot-price">{SEED_COST}p</span>
      </div>
    );
  }
  if (plot.state === 'growing') {
    const progress = Math.min(1, (Date.now() - plot.plantedAt) / (growTime * 1000));
    const sprite = progress < 0.5 ? 'field-sown' : 'field-growing';
    return (
      <div className="plot growing" style={{ backgroundImage: `url(/sprites/${sprite}.webp)` }}>
        <span className="plot-bar"><span className="plot-bar-fill" style={{ width: `${progress * 100}%` }} /></span>
      </div>
    );
  }
  return (
    <div className="plot ready" style={{ backgroundImage: 'url(/sprites/field-ready.webp)' }} onClick={onClick} />
  );
}

function ModeToggle({ label, value, onChange, combineLabel, combineIcon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem', color: '#a8a498', marginBottom: 10 }}>
      <span style={{ minWidth: 112, display: 'inline-block' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onChange('manual')}
          style={value === 'manual' ? { background: 'var(--gold)', color: 'var(--ink)' } : undefined}
        >
          À la main
        </button>
        <button
          onClick={() => onChange('combine')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            ...(value === 'combine' ? { background: 'var(--gold)', color: 'var(--ink)' } : {}),
          }}
        >
          {combineIcon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={combineIcon} alt="" style={{ height: '1.2em', width: 'auto', imageRendering: 'pixelated' }} />
          )}
          {combineLabel}
        </button>
      </div>
    </div>
  );
}

function InvestButton({ maxed, afford, cost, onClick }) {
  const sprite = maxed ? '/sprites/btn-max.webp' : afford ? '/sprites/btn-on.webp' : '/sprites/btn-off.webp';
  const color = maxed ? 'var(--ink)' : afford ? 'var(--paper)' : '#5a584f';
  return (
    <button
      className="full-btn"
      disabled={maxed}
      onClick={onClick}
      style={{
        backgroundImage: `url(${sprite})`,
        backgroundSize: '100% 100%',
        backgroundColor: 'transparent',
        border: 'none',
        color,
        fontWeight: maxed ? 700 : 600,
      }}
    >
      {maxed ? 'Investissement maximal' : `Investir — ${cost}p`}
    </button>
  );
}

function FarmChoiceScreen({ state, onChoose }) {
  const tiers = choiceTierCount(state);
  return (
    <div className="field-wrap">
      <h2>Choisis ta nouvelle exploitation</h2>
      <p className="field-caption">
        Ta trésorerie actuelle finance l&rsquo;achat. Si tu ne peux pas te permettre l&rsquo;exploitation
        agrandie, tu repars sur une exploitation de même taille.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
        {Array.from({ length: tiers }, (_, tier) => {
          const cols = state.farmCols + tier;
          const rows = state.farmRows + tier;
          const cost = choiceTierCost(tier, state);
          const afford = state.money >= cost;
          return (
            <div
              key={tier}
              style={{
                flex: '1 1 220px', background: 'var(--paper)', color: 'var(--ink)',
                border: '1px solid var(--paper-line)', borderRadius: 5, padding: '16px 18px', textAlign: 'center',
              }}
            >
              <h3 style={{ fontFamily: "'Pixelify Sans','Courier New',monospace", margin: '0 0 8px', fontSize: '1rem' }}>
                {tier === 0 ? 'Même taille' : `Agrandie (+${tier} ligne${tier > 1 ? 's' : ''}, +${tier} colonne${tier > 1 ? 's' : ''})`}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '0 0 10px' }}>{cols} × {rows} parcelles</p>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>
                {cost.toLocaleString()} p
              </div>
              <button className="full-btn" disabled={!afford} onClick={() => onChoose(tier)}>
                Choisir cette exploitation
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

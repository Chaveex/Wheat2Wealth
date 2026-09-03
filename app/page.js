'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FREE_PLOTS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
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
  getRowBlock,
  moissonneusePenalty,
  semoirMecaFailChance,
  courtierTax,
  COURTIER_THRESHOLD,
  computeResaleValue,
  rebuildCost,
  choiceTierCount,
  choiceTierCost,
  harvesterSprite,
  seederSprite,
  formatDuration,
  maxWorkerSlots,
  workerSlotCost,
  sellShortcutCost,
  SELL_SHORTCUT_MIN_GEN,
  fillBonusPct,
  siloEffectiveCap,
  currentFillBonus,
  FILL_BONUS_MIN_GEN,
  SILO_BUFFER_MULT,
  fieldCellSize,
  MAX_FARM_SIZE,
  bagSize,
  bagRequiredGen,
  bagUpgradeCost,
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
        <h1 style={{ display: 'flex', justifyContent: 'center' }}>
          <img src="/sprites/logo.webp" alt="Wheat2Wealth" style={{ width: 218.117, height: 76, display: 'block' }} />
        </h1>
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
  const [collapsedTechs, setCollapsedTechs] = useState({});
  function toggleTechCollapsed(key, currentlyCollapsed) {
    setCollapsedTechs((prev) => ({ ...prev, [key]: !currentlyCollapsed }));
  }
  const [kbdPressed, setKbdPressed] = useState(false);
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

  // Purely visual re-render trigger: playtime, the live p/s indicator, and
  // the ouvrier/semeur progress bars all change continuously even when
  // nothing in `state` itself changes. 300ms keeps the progress bars smooth.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, []);

  // Space-bar shortcut for a manual sell, once the "Raccourci de vente"
  // technology is owned and the player hasn't switched it off. preventDefault
  // fires only when we're actually about to sell, so Space keeps its normal
  // behaviour (page scroll, activating a focused button...) the rest of the
  // time.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const s = stateRef.current;
      if (!s || s.gamePhase !== 'playing') return;
      if (!s.upgrades.sellShortcut || s.upgrades.sellShortcut.level <= 0) return;
      if (!s.settings?.sellShortcutEnabled) return;
      if (s.wheat <= 0) return;
      e.preventDefault();
      sell();
      setKbdPressed(true);
      setTimeout(() => setKbdPressed(false), 150);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Visual-only feedback: floating "+X" gains, worker/sower ring
  // flashes, and the full-row hover preview for the machines. None of this is
  // persisted — it's purely reactive game feel layered on top of `state`.
  const fieldRef = useRef(null);
  const sellBtnRef = useRef(null);
  const [previewBlock, setPreviewBlock] = useState([]);
  const [flashes, setFlashes] = useState([]); // [{id, idx, type: 'worker'|'sower'}]
  const flashIdRef = useRef(0);
  const [floatingGains, setFloatingGains] = useState([]); // [{id, left, top, text, cls}]
  const gainIdRef = useRef(0);
  const courtierAudioRef = useRef(null);
  const manualAudioRef = useRef(null);
  const overflowAudioRef = useRef(null);
  const wasOverflowingRef = useRef(false);

  // Queue of visual effects requested from *inside* a setState updater
  // (harvest/plant, and the automation tick). Writing to a ref is a plain,
  // synchronous JS mutation, so it's reliable no matter when React actually
  // gets around to calling the updater — unlike calling setFlashes/
  // setFloatingGains directly from in there, which can silently never fire
  // if the updater turns out to run later than expected. A no-deps effect
  // below drains this queue after every render.
  const pendingEffectsRef = useRef([]);
  function queueFlash(idx, type) {
    pendingEffectsRef.current.push({ kind: 'flash', idx, type });
  }
  function queueGain(idx, text, cls) {
    pendingEffectsRef.current.push({ kind: 'gain', idx, text, cls });
  }
  function queueMoneyGain(amount) {
    pendingEffectsRef.current.push({ kind: 'moneyGain', amount });
  }
  function queueSound(name) {
    pendingEffectsRef.current.push({ kind: 'sound', name });
  }
  function queueStopSound(name) {
    pendingEffectsRef.current.push({ kind: 'stopSound', name });
  }

  function stopOverflowSound() {
    const el = overflowAudioRef.current;
    if (el && !el.paused) {
      el.pause();
      el.currentTime = 0;
    }
  }

  function addFlash(idx, type) {
    const id = ++flashIdRef.current;
    setFlashes((prev) => [...prev, { id, idx, type }]);
    setTimeout(() => setFlashes((prev) => prev.filter((f) => f.id !== id)), 650);
  }

  function spawnFloatingGainFromRect(rect, data) {
    const id = ++gainIdRef.current;
    setFloatingGains((prev) => [...prev, { id, left: rect.left + rect.width / 2, top: rect.top, ...data }]);
    setTimeout(() => setFloatingGains((prev) => prev.filter((g) => g.id !== id)), 950);
  }

  function spawnFloatingGain(idx, text, cls) {
    const el = fieldRef.current?.children[idx];
    if (!el) return;
    spawnFloatingGainFromRect(el.getBoundingClientRect(), { kind: 'text', text, cls });
  }

  function spawnMoneyGain(amount) {
    const el = sellBtnRef.current;
    if (!el) return;
    spawnFloatingGainFromRect(el.getBoundingClientRect(), { kind: 'money', amount });
  }

  // Runs after every render (deliberately no dependency array): flushes
  // whatever visual effects were queued by the last state update, however
  // it got triggered.
  useEffect(() => {
    if (pendingEffectsRef.current.length === 0) return;
    const queue = pendingEffectsRef.current;
    pendingEffectsRef.current = [];
    queue.forEach((effect) => {
      if (effect.kind === 'flash') addFlash(effect.idx, effect.type);
      else if (effect.kind === 'gain') spawnFloatingGain(effect.idx, effect.text, effect.cls);
      else if (effect.kind === 'moneyGain') spawnMoneyGain(effect.amount);
      else if (effect.kind === 'sound') {
        const audioRefByName = {
          manualSold: manualAudioRef,
          courtierSold: courtierAudioRef,
          overflowWarning: overflowAudioRef,
        };
        const ref = audioRefByName[effect.name];
        const el = ref?.current;
        if (el) {
          el.currentTime = 0;
          el.play().catch((err) => {
            console.error(`Impossible de jouer le son "${effect.name}" :`, err);
            pushLog(`Son non joué (${err?.name || 'erreur inconnue'}) — vérifie public/soundEffect/.`);
          });
        }
      }
      else if (effect.kind === 'stopSound') {
        if (effect.name === 'overflowWarning') stopOverflowSound();
      }
    });
  });

  function updatePreview(idx) {
    const plot = state?.plots[idx];
    if (!plot) return setPreviewBlock([]);
    const wantsHarvestPreview = plot.state === 'ready' && harvestMode === 'combine' && state.upgrades.moissonneuse.level > 0;
    const wantsSowPreview = plot.state === 'empty' && sowMode === 'combine' && state.upgrades.semoirMeca.level > 0;
    if (!wantsHarvestPreview && !wantsSowPreview) return setPreviewBlock([]);
    setPreviewBlock(getRowBlock(idx, state.farmCols));
  }

  // Drag-to-buy: mousedown on a locked plot arms dragging and buys it right
  // away; every other locked plot the cursor enters while still held down
  // gets bought too. A window-level mouseup (not just over the grid) always
  // disarms it, so releasing outside the field doesn't leave it stuck on.
  const isBuyDraggingRef = useRef(false);
  useEffect(() => {
    function stopDrag() { isBuyDraggingRef.current = false; }
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  function startBuyDrag(i) {
    isBuyDraggingRef.current = true;
    buyPlot(i);
  }

  function dragOverPlot(i, plotState) {
    updatePreview(i);
    if (isBuyDraggingRef.current && plotState === 'locked') buyPlot(i);
  }

  // Growth tick + automation (ouvrier agricole / semeur automatique).
  const harvestCursorsRef = useRef([-1]);
  const sowCursorsRef = useRef([-1]);
  const lastHarvestsRef = useRef([0]);
  const lastSowsRef = useRef([0]);

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
          const workerCount = prev.upgrades.ouvrier.count || 1;
          while (harvestCursorsRef.current.length < workerCount) harvestCursorsRef.current.push(-1);
          while (lastHarvestsRef.current.length < workerCount) lastHarvestsRef.current.push(Date.now());
          for (let w = 0; w < workerCount; w++) {
            if (prev.upgrades.ouvrier.enabled?.[w] === false) {
              // Paused: keep the timer pinned to "just reset" so re-enabling
              // starts a fresh interval instead of firing an instant catch-up.
              lastHarvestsRef.current[w] = Date.now();
              continue;
            }
            if (!lastHarvestsRef.current[w]) lastHarvestsRef.current[w] = Date.now();
            if (Date.now() - lastHarvestsRef.current[w] >= hInterval * 1000) {
              // Sequential on purpose: each worker sees the plots array as
              // already updated by the ones before it this same tick, so
              // two workers can never both grab the same ready plot.
              const bagCount = bagSize(prev, 'sacOuvrier');
              let cursor = harvestCursorsRef.current[w];
              for (let b = 0; b < bagCount; b++) {
                const idx = findNextIndex(plots, cursor, (p) => p.state === 'ready');
                if (idx === -1) break;
                const amount = yieldAmount(prev);
                const cap = siloEffectiveCap(prev);
                const space = cap - wheat;
                const added = Math.min(amount, Math.max(0, space));
                if (plots === prev.plots) plots = plots.slice();
                plots[idx] = { state: 'empty', plantedAt: null };
                wheat += added;
                statHarvested += added;
                statLost += amount - added;
                cursor = idx;
                changed = true;
                queueFlash(idx, 'worker');
                if (added > 0) queueGain(idx, `+${added} 🌾`, 'gain-wheat');
              }
              harvestCursorsRef.current[w] = cursor;
              lastHarvestsRef.current[w] = Date.now();
            }
          }
        }

        const sInterval = semeurInterval(prev);
        if (sInterval !== null) {
          const sowerCount = prev.upgrades.semeur.count || 1;
          while (sowCursorsRef.current.length < sowerCount) sowCursorsRef.current.push(-1);
          while (lastSowsRef.current.length < sowerCount) lastSowsRef.current.push(Date.now());
          for (let w = 0; w < sowerCount; w++) {
            if (prev.upgrades.semeur.enabled?.[w] === false) {
              lastSowsRef.current[w] = Date.now();
              continue;
            }
            if (!lastSowsRef.current[w]) lastSowsRef.current[w] = Date.now();
            if (Date.now() - lastSowsRef.current[w] >= sInterval * 1000) {
              const bagCount = bagSize(prev, 'sacSemeur');
              let cursor = sowCursorsRef.current[w];
              for (let b = 0; b < bagCount; b++) {
                if (money < SEED_COST) break;
                const idx = findNextIndex(plots, cursor, (p) => p.state === 'empty');
                if (idx === -1) break;
                if (plots === prev.plots) plots = plots.slice();
                plots[idx] = { state: 'growing', plantedAt: Date.now() };
                money -= SEED_COST;
                statSpent += SEED_COST;
                cursor = idx;
                changed = true;
                dirtyRef.current = true;
                queueFlash(idx, 'sower');
                queueGain(idx, '🌱', 'gain-sow');
              }
              sowCursorsRef.current[w] = cursor;
              lastSowsRef.current[w] = Date.now();
            }
          }
        }

        if (courtierActiveRef.current && prev.upgrades.courtier.level > 0) {
          const cap = siloCap(prev);
          if (cap > 0 && wheat >= cap * COURTIER_THRESHOLD) {
            const bonus = prev.generation >= FILL_BONUS_MIN_GEN ? fillBonusPct(wheat / cap) : 0;
            const gross = Math.round(wheat * SELL_PRICE * (1 + bonus));
            const tax = courtierTax(prev);
            const total = Math.round(gross * (1 - tax));
            pushLog(`Vente automatique (courtier) de ${wheat} unités de blé pour ${total}p (bonus +${Math.round(bonus * 100)}%, taxe ${Math.round(tax * 100)}%).`);
            statEarned += total;
            statSold += wheat;
            statSales += 1;
            newSale = { t: Date.now(), amount: total };
            money += total;
            wheat = 0;
            changed = true;
            dirtyRef.current = true;
            queueSound('courtierSold');
            queueMoneyGain(total);
          }
        }

        if (prev.generation >= FILL_BONUS_MIN_GEN) {
          const nominalCap = siloCap(prev);
          if (wheat > nominalCap && !wasOverflowingRef.current) {
            wasOverflowingRef.current = true;
            queueSound('overflowWarning');
          } else if (wheat <= nominalCap && wasOverflowingRef.current) {
            wasOverflowingRef.current = false;
            queueStopSound('overflowWarning');
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

  const bestScoreRef = useRef(0);
  bestScoreRef.current = bestScore;

  // Autosave loop.
  useEffect(() => {
    const id = setInterval(async () => {
      if (dirtyRef.current && stateRef.current) {
        dirtyRef.current = false;
        const money = Math.round(stateRef.current.money);
        const newBest = Math.max(bestScoreRef.current, money);
        if (newBest !== bestScoreRef.current) setBestScore(newBest);
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
  }, [refreshLeaderboard]);

  function markDirty() {
    dirtyRef.current = true;
  }

  // Best-effort save if the tab is closed/reloaded before the next autosave
  // tick — keepalive lets the request survive the page unloading.
  useEffect(() => {
    function handleUnload() {
      if (dirtyRef.current && stateRef.current) {
        const money = Math.round(stateRef.current.money);
        const newBest = Math.max(bestScoreRef.current, money);
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
  }, []);

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
      const indices = useCombine ? getRowBlock(i, prev.farmCols) : [i];
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
          queueGain(idx, '✕', 'gain-fail');
        } else {
          plots[idx] = { state: 'growing', plantedAt: Date.now() };
          queueGain(idx, '🌱', 'gain-sow');
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
      const indices = useCombine ? getRowBlock(i, prev.farmCols) : [i];
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
        const cap = siloEffectiveCap(prev);
        const space = cap - wheat;
        const added = Math.min(amount, Math.max(0, space));
        if (added < amount) {
          pushLog(`Silo plein ! ${amount - added} unités de blé perdues.`);
          lost += amount - added;
        }
        wheat += added;
        harvested += added;
        plots[idx] = { state: 'empty', plantedAt: null };
        if (added > 0) queueGain(idx, `+${added} 🌾`, 'gain-wheat');
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
      const bonus = currentFillBonus(prev);
      const total = Math.round(prev.wheat * SELL_PRICE * (1 + bonus));
      pushLog(`Vente de ${prev.wheat} unités de blé pour ${total}p${bonus > 0 ? ` (bonus de remplissage +${Math.round(bonus * 100)}%)` : ''}.`);
      markDirty();
      wasOverflowingRef.current = false;
      queueSound('manualSold');
      queueStopSound('overflowWarning');
      queueMoneyGain(total);
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
      if (key === 'sellShortcut' && prev.generation < SELL_SHORTCUT_MIN_GEN) {
        pushLog(`${def.name} verrouillé(e) : disponible à partir de la génération ${SELL_SHORTCUT_MIN_GEN}.`);
        return prev;
      }
      if ((key === 'sacOuvrier' || key === 'sacSemeur')) {
        const nextLevelCount = u.level + 2;
        const requiredGen = bagRequiredGen(nextLevelCount);
        if (prev.generation < requiredGen) {
          pushLog(`${def.name} verrouillé(e) : niveau ${nextLevelCount} disponible à partir de la génération ${requiredGen}.`);
          return prev;
        }
      }
      const cost = key === 'sellShortcut'
        ? sellShortcutCost(prev)
        : (key === 'sacOuvrier' || key === 'sacSemeur')
          ? bagUpgradeCost(key, prev)
          : upgradeCost(key, u.level, prev);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour "${def.name}" (${cost}p).`);
        return prev;
      }
      pushLog(`Investissement : ${def.name} (niveau ${u.level + 1}).`);
      markDirty();
      return {
        ...prev,
        money: prev.money - cost,
        upgrades: { ...prev.upgrades, [key]: { ...u, level: u.level + 1, totalInvested: (u.totalInvested || 0) + cost } },
        stats: { ...prev.stats, totalSpent: prev.stats.totalSpent + cost },
      };
    });
  }

  function toggleSellShortcut() {
    setState((prev) => {
      if (!prev) return prev;
      markDirty();
      return { ...prev, settings: { ...prev.settings, sellShortcutEnabled: !prev.settings.sellShortcutEnabled } };
    });
  }

  function hireWorker(key) {
    setState((prev) => {
      if (!prev) return prev;
      const u = prev.upgrades[key];
      if (u.level <= 0) return prev;
      const count = u.count || 1;
      const maxSlots = maxWorkerSlots(prev);
      if (count >= maxSlots) return prev;
      const cost = workerSlotCost(count + 1, prev);
      if (prev.money < cost) {
        pushLog(`Pas assez de trésorerie pour embaucher un ${key === 'ouvrier' ? 'ouvrier' : 'semeur'} supplémentaire (${cost}p).`);
        return prev;
      }
      const label = key === 'ouvrier' ? 'Ouvrier agricole' : 'Semeur automatique';
      pushLog(`${label} #${count + 1} embauché pour ${cost}p, au niveau ${u.level}.`);
      markDirty();
      // Spread the new worker's starting cursor evenly across the field
      // instead of 0, so it doesn't start by retracing the first worker's
      // steps — give it a head start proportional to its slot number.
      const cursorsRef = key === 'ouvrier' ? harvestCursorsRef : sowCursorsRef;
      const lastRef = key === 'ouvrier' ? lastHarvestsRef : lastSowsRef;
      const total = prev.plots.length;
      const newCount = count + 1;
      cursorsRef.current[newCount - 1] = Math.floor(((newCount - 1) * total) / newCount) - 1;
      lastRef.current[newCount - 1] = Date.now();
      const enabled = (u.enabled ? u.enabled.slice() : []);
      enabled[newCount - 1] = true;
      return {
        ...prev,
        money: prev.money - cost,
        upgrades: { ...prev.upgrades, [key]: { ...u, count: newCount, enabled } },
        stats: { ...prev.stats, totalSpent: prev.stats.totalSpent + cost },
      };
    });
  }

  function toggleWorkerEnabled(key, w) {
    setState((prev) => {
      if (!prev) return prev;
      const u = prev.upgrades[key];
      const enabled = u.enabled ? u.enabled.slice() : [];
      while (enabled.length <= w) enabled.push(true);
      enabled[w] = !enabled[w];
      markDirty();
      return { ...prev, upgrades: { ...prev.upgrades, [key]: { ...u, enabled } } };
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
    harvestCursorsRef.current = [-1];
    lastHarvestsRef.current = [0];
    sowCursorsRef.current = [-1];
    lastSowsRef.current = [0];
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
      upgrades.ouvrier.count = 1;
      upgrades.ouvrier.enabled = [true];
      upgrades.semeur.count = 1;
      upgrades.semeur.enabled = [true];
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
    // A resale rebuilds from a single worker of each kind — trim the
    // per-worker cursor/timer arrays back down to match.
    harvestCursorsRef.current = [-1];
    lastHarvestsRef.current = [0];
    sowCursorsRef.current = [-1];
    lastSowsRef.current = [0];
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

  // The original starting size is always available for free — a hard floor
  // so a player who mismanaged a generation can never be permanently
  // stuck unable to afford any farm at all.
  function chooseBaseFarm() {
    setState((prev) => {
      if (!prev) return prev;
      pushLog(`Nouvelle exploitation choisie : ${DEFAULT_COLS} × ${DEFAULT_ROWS} parcelles (gratuite).`);
      markDirty();
      return {
        ...prev,
        farmCols: DEFAULT_COLS,
        farmRows: DEFAULT_ROWS,
        plots: freshPlots(DEFAULT_COLS, DEFAULT_ROWS),
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
  const sellFillBonus = currentFillBonus(state);
  const cellPx = fieldCellSize(state);
  const costPerUnit = state.stats.totalWheatHarvested > 0 ? state.stats.totalSpent / state.stats.totalWheatHarvested : 0;
  const netProfit = state.stats.totalEarned - state.stats.totalSpent;
  const idealCadence = owned > 0 ? growTimeSeconds(state) / owned : growTimeSeconds(state);
  const sowerInterval = semeurInterval(state);
  const harvestInterval = ouvrierInterval(state);
  const ouvrierCount = state.upgrades.ouvrier.count || 1;
  const semeurCount = state.upgrades.semeur.count || 1;
  const harvestProgresses = Array.from({ length: ouvrierCount }, (_, w) => {
    const last = lastHarvestsRef.current[w];
    return harvestInterval && last ? Math.min(1, (Date.now() - last) / (harvestInterval * 1000)) : 0;
  });
  const sowProgresses = Array.from({ length: semeurCount }, (_, w) => {
    const last = lastSowsRef.current[w];
    return sowerInterval && last ? Math.min(1, (Date.now() - last) / (sowerInterval * 1000)) : 0;
  });
  const maxSlots = maxWorkerSlots(state);
  const nextOuvrierCost = workerSlotCost(ouvrierCount + 1, state);
  const nextSemeurCost = workerSlotCost(semeurCount + 1, state);

  return (
    <>
      <audio
        ref={courtierAudioRef}
        src="/soundEffect/courtierSold.mp3"
        preload="auto"
        onError={() => console.error("Le fichier /soundEffect/courtierSold.mp3 est introuvable ou invalide (vérifie le chemin et le nom exact dans public/).")}
      />
      <audio
        ref={manualAudioRef}
        src="/soundEffect/manualSold.mp3"
        preload="auto"
        onError={() => console.error("Le fichier /soundEffect/manualSold.mp3 est introuvable ou invalide (vérifie le chemin et le nom exact dans public/).")}
      />
      <audio
        ref={overflowAudioRef}
        src="/soundEffect/Heavy_soviet_warning_reverb.mp3"
        preload="auto"
        onError={() => console.error("Le fichier /soundEffect/Heavy_soviet_warning_reverb.mp3 est introuvable ou invalide (vérifie le chemin et le nom exact dans public/).")}
      />
      <div className="topbar">
        <h1><img src="/sprites/logo.webp" alt="Wheat2Wealth" style={{ width: 126.23, height: 44, display: 'block' }} /></h1>
        <div className="topbar-metrics">
          <div className="metric">
            <span className="metric-label">Trésorerie</span>
            <span className="metric-value treasury">
              {Math.round(state.money).toLocaleString()}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sprites/currencyCoin.webp" alt="p" className="currency-icon-inline" />
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Revenu</span>
            <span className="metric-value revenue">
              {perSecond >= 0 ? '+' : ''}{perSecond.toFixed(1)}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sprites/currencyCoin.webp" alt="p" className="currency-icon-inline" />/s
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Gaspillage</span>
            <span className="metric-value waste">{wastePct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="top-right">
          <RadioWidget />
          <span>
            Joueur : <b>{username}</b>
          </span>
          <button className="link-btn" onClick={handleLogout}>
            changer de compte
          </button>
          <button className={`link-btn ${resetArmed ? 'armed' : ''}`} onClick={handleReset}>
            {resetArmed ? 'Confirmer ? Tout sera perdu' : 'réinitialiser ma partie'}
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ background: 'var(--alert)', color: '#fff', padding: '8px 20px', fontSize: '0.8rem', textAlign: 'center' }}>
          ⚠ {saveError}
        </div>
      )}

      <div className="layout">
        {state.gamePhase === 'choosing' ? (
          <FarmChoiceScreen state={state} onChoose={chooseFarm} onChooseBase={chooseBaseFarm} />
        ) : (
          <div className="field-wrap">
            <div className="field-caption">
              Clique une parcelle libre pour l&rsquo;acheter, une parcelle semée pour la récolter.
            </div>
            {state.upgrades.ouvrier.level > 0 && harvestProgresses.map((p, w) => (
              <AutoTimerBar
                key={`h${w}`}
                label={`${ouvrierCount > 1 ? `Ouvrier #${w + 1}` : 'Ouvrier'} — prochaine récolte${bagSize(state, 'sacOuvrier') > 1 ? ` (×${bagSize(state, 'sacOuvrier')})` : ''}`}
                progress={p}
                colorVar="--gold"
                paused={state.upgrades.ouvrier.enabled?.[w] === false}
                onToggle={() => toggleWorkerEnabled('ouvrier', w)}
              />
            ))}
            {state.upgrades.semeur.level > 0 && sowProgresses.map((p, w) => (
              <AutoTimerBar
                key={`s${w}`}
                label={`${semeurCount > 1 ? `Semeur #${w + 1}` : 'Semeur'} — prochain semis${bagSize(state, 'sacSemeur') > 1 ? ` (×${bagSize(state, 'sacSemeur')})` : ''}`}
                progress={p}
                colorVar="--gold-bright"
                paused={state.upgrades.semeur.enabled?.[w] === false}
                onToggle={() => toggleWorkerEnabled('semeur', w)}
              />
            ))}
            {state.upgrades.moissonneuse.level > 0 && (
              <ModeToggle
                label="Mode de récolte :"
                value={harvestMode}
                onChange={setHarvestMode}
                combineLabel={`Moissonneuse (ligne entière, -${Math.round(moissonneusePenalty(state) * 100)}%)`}
                combineIcon={harvesterSprite(state.upgrades.moissonneuse.level)}
              />
            )}
            {state.upgrades.semoirMeca.level > 0 && (
              <ModeToggle
                label="Mode de semis :"
                value={sowMode}
                onChange={setSowMode}
                combineLabel={`Semoir (ligne entière, ${Math.round(semoirMecaFailChance(state) * 100)}% d'échec)`}
                combineIcon={seederSprite(state.upgrades.semoirMeca.level)}
              />
            )}
            <div
              className="field"
              ref={fieldRef}
              style={{ gridTemplateColumns: `repeat(${state.farmCols}, ${cellPx}px)` }}
              onMouseLeave={() => setPreviewBlock([])}
            >
              {state.plots.map((p, i) => (
                <Plot key={i} plot={p} cost={nextPlotCost} money={state.money}
                  growTime={growTimeSeconds(state)}
                  preview={previewBlock.includes(i)}
                  flash={flashes.find((f) => f.idx === i)?.type}
                  onMouseEnter={() => dragOverPlot(i, p.state)}
                  onMouseDown={() => {
                    if (p.state === 'locked') startBuyDrag(i);
                  }}
                  onClick={() => {
                    if (p.state === 'empty') plant(i);
                    else if (p.state === 'ready') harvest(i);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {floatingGains.map((g) => (
          <div
            key={g.id}
            className={`floating-gain ${g.kind === 'money' ? 'gain-money' : g.cls || ''}`}
            style={{ left: g.left, top: g.top }}
          >
            {g.kind === 'money' ? (
              <>
                +{g.amount.toLocaleString()}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/sprites/currencyCoin.webp" alt="p" className="currency-icon-inline" />
              </>
            ) : g.text}
          </div>
        ))}

        <div className="ledger panel-col-2">
          <Section title="Parcelles">
            <div className="row"><span>Prochaine parcelle</span><span>{nextPlotCost} p</span></div>
            <div className="row"><span>Semer une parcelle libre</span><span>{SEED_COST} p</span></div>
            <div className="row muted"><span>Temps de pousse</span><span>{growTimeSeconds(state).toFixed(1)} s</span></div>
          </Section>
          <hr />
          <Section title="Silo">
            <SiloBar wheat={state.wheat} cap={siloCap(state)} bufferCap={siloEffectiveCap(state)} showBuffer={state.generation >= FILL_BONUS_MIN_GEN} />
            <div className="row"><span>Prix de vente (fixe)</span><span>{SELL_PRICE.toFixed(1)} p</span></div>
            {state.generation >= FILL_BONUS_MIN_GEN && (
              <div className="row">
                <span>Bonus de remplissage actuel</span>
                <span className={sellFillBonus > 0.05 ? 'fill-bonus-hot' : undefined}>+{Math.round(sellFillBonus * 100)}%</span>
              </div>
            )}
            <button
              ref={sellBtnRef}
              className={`full-btn sell-btn ${state.wheat > 0 ? 'ready' : ''} ${kbdPressed ? 'kbd-press' : ''}`}
              disabled={state.wheat <= 0}
              onClick={sell}
              style={{ backgroundImage: `url(${state.wheat > 0 ? '/sprites/sell-on.webp' : '/sprites/sell-off.webp'})` }}
            >
              VENTE À LA CRIÉE {Math.round(state.wheat * SELL_PRICE * (1 + sellFillBonus))}p
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
            {state.upgrades.sellShortcut.level > 0 && (
              <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
                <span>Raccourci vente (Espace) :</span>
                <button
                  onClick={toggleSellShortcut}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}
                  aria-label={state.settings.sellShortcutEnabled ? 'Activé' : 'Désactivé'}
                  title={state.settings.sellShortcutEnabled ? 'Activé' : 'Désactivé'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.settings.sellShortcutEnabled ? '/sprites/toggle-on.webp' : '/sprites/toggle-off.webp'}
                    alt={state.settings.sellShortcutEnabled ? 'Activé' : 'Désactivé'}
                    style={{ height: 26, width: 'auto', imageRendering: 'pixelated', display: 'block' }}
                  />
                </button>
              </div>
            )}
          </Section>
          <hr />
          <Section title="Exploitation">
            <div className="row"><span>Génération</span><span>{state.generation}</span></div>
            <div className="row"><span>Taille du terrain</span><span>{state.farmCols} × {state.farmRows}</span></div>
            <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', margin: '6px 0 8px', lineHeight: 1.4 }}>
              Vendre l&rsquo;exploitation convertit tes parcelles et technologies en trésorerie (40% de ce
              que tu as investi), remet tout à zéro, et te fait passer à la génération suivante — plus
              chère, mais plus efficace.
            </p>
            <div className="row"><span>Trésorerie post-vente</span><span>{(state.money + computeResaleValue(state)).toLocaleString()} p</span></div>
            <div className="row">
              <span>Exploitation même taille (gén. {state.generation + 1})</span>
              <span>{rebuildCost(state.farmCols, state.farmRows, { ...state, generation: state.generation + 1 }).toLocaleString()} p</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--warn)', margin: '8px 0 10px', lineHeight: 1.4, fontWeight: 600 }}>
              ⚠ Si ta trésorerie post-vente ne couvre pas ce prix, tu ne pourras reprendre qu&rsquo;une
              exploitation plus petite. L&rsquo;exploitation de départ ({DEFAULT_COLS}×{DEFAULT_ROWS})
              reste cependant toujours gratuite, quoi qu&rsquo;il arrive.
            </p>
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
          </Section>
          <hr />
          <Section title="Efficacité de la ferme">
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
          </Section>
          <hr />
          <Section title="Registre" defaultCollapsed>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 110, overflowY: 'auto' }}>
              {log.map((m, i) => (
                <li key={i} style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', padding: '3px 0' }}>{m}</li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="ledger panel-col-3">
          <Section title="Investissements">
            {Object.keys(UPGRADE_DEFS).map((key) => {
              const def = UPGRADE_DEFS[key];
              const u = state.upgrades[key];
              const maxed = u.level >= def.max;
              const isCollapsed = collapsedTechs[key] !== undefined ? collapsedTechs[key] : maxed;
              const cost = key === 'sellShortcut'
                ? sellShortcutCost(state)
                : (key === 'sacOuvrier' || key === 'sacSemeur')
                  ? bagUpgradeCost(key, state)
                  : upgradeCost(key, u.level, state);
              let desc = def.desc;
              if (key === 'graines') {
                desc = `Augmente le rendement par récolte. Rendement actuel : ${yieldAmount(state)} unités de blé par parcelle récoltée.`;
              } else if (key === 'ouvrier') {
                const count = u.count || 1;
                desc = u.level <= 0
                  ? "Aucun ouvrier pour l'instant : il faut récolter les parcelles prêtes toi-même."
                  : `Récolte une parcelle prête toutes les ${ouvrierInterval(state).toFixed(1)} s. ${count > 1 ? `${count} ouvriers actifs.` : '1 ouvrier actif.'}`;
              } else if (key === 'semeur') {
                const count = u.count || 1;
                desc = u.level <= 0
                  ? "Aucun semeur pour l'instant : les parcelles vides restent vides tant que tu ne sèmes pas toi-même."
                  : `Sème une parcelle vide toutes les ${semeurInterval(state).toFixed(1)} s. ${count > 1 ? `${count} semeurs actifs.` : '1 semeur actif.'}`;
              } else if (key === 'moissonneuse') {
                desc = u.level <= 0
                  ? "Débloque d'abord 4 lignes ou 4 colonnes complètes de parcelles achetées pour pouvoir l'acheter."
                  : `Permet de récolter une ligne entière d'un coup (à toi de choisir le mode). Pénalité de rendement actuelle en mode moissonneuse : -${Math.round(moissonneusePenalty(state) * 100)}%.`;
              } else if (key === 'semoirMeca') {
                desc = u.level <= 0
                  ? "Débloque d'abord 4 lignes ou 4 colonnes complètes de parcelles achetées pour pouvoir l'acheter."
                  : `Permet de semer une ligne entière d'un coup (à toi de choisir le mode). Risque actuel qu'une parcelle ne prenne pas : ${Math.round(semoirMecaFailChance(state) * 100)}%.`;
              } else if (key === 'courtier') {
                desc = u.level <= 0
                  ? 'Vend automatiquement le blé quand le silo est presque plein, contre une taxe.'
                  : `Vend automatiquement tout le blé dès que le silo atteint ${Math.round(COURTIER_THRESHOLD * 100)}% de sa capacité. Taxe actuelle : ${Math.round(courtierTax(state) * 100)}%. Vendre à la main reste plus rentable (jamais de taxe).`;
              } else if (key === 'sellShortcut') {
                desc = u.level > 0
                  ? "Appuie sur Espace pour vendre tout le blé du silo, sans avoir à cliquer. Désactivable dans le panneau Silo."
                  : state.generation < SELL_SHORTCUT_MIN_GEN
                    ? `Disponible à partir de la génération ${SELL_SHORTCUT_MIN_GEN} (actuellement génération ${state.generation}).`
                    : "Débloque la touche Espace comme raccourci pour vendre tout le blé du silo d'un coup.";
              } else if (key === 'sacOuvrier' || key === 'sacSemeur') {
                const currentBag = bagSize(state, key);
                const nextLevelCount = u.level + 2;
                const requiredGen = bagRequiredGen(nextLevelCount);
                const verb = key === 'sacOuvrier' ? 'récolte' : 'sème';
                desc = u.level >= UPGRADE_DEFS[key].max
                  ? `Chaque ouvrier ${verb} ${currentBag} parcelles adjacentes par action (niveau maximal).`
                  : state.generation < requiredGen
                    ? `Niveau ${nextLevelCount} disponible à partir de la génération ${requiredGen} (actuellement génération ${state.generation}). Actuellement : ${currentBag} parcelle${currentBag > 1 ? 's' : ''} par action.`
                    : `Chaque ${key === 'sacOuvrier' ? 'ouvrier' : 'semeur'} ${verb} actuellement ${currentBag} parcelle${currentBag > 1 ? 's' : ''} adjacente${currentBag > 1 ? 's' : ''} par action, au lieu d'une seule.`;
              }
              const gated = ((key === 'moissonneuse' || key === 'semoirMeca') && u.level === 0 && !meets4LinesRequirement(state.plots, state.farmCols, state.farmRows))
                || (key === 'sellShortcut' && u.level === 0 && state.generation < SELL_SHORTCUT_MIN_GEN)
                || ((key === 'sacOuvrier' || key === 'sacSemeur') && u.level < UPGRADE_DEFS[key].max && state.generation < bagRequiredGen(u.level + 2));
              const afford = state.money >= cost;
              let icon = null;
              if (key === 'moissonneuse') icon = harvesterSprite(u.level);
              else if (key === 'semoirMeca') icon = seederSprite(u.level);
              return (
                <div className="upgrade" key={key}>
                  <div
                    className="upgrade-top upgrade-top-clickable"
                    onClick={() => toggleTechCollapsed(key, isCollapsed)}
                  >
                    <span className="upgrade-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={icon} alt="" style={{ height: '1.3em', width: 'auto', imageRendering: 'pixelated' }} />
                      )}
                      {def.name}
                      {isCollapsed && maxed && <span className="tech-max-badge">✓ MAX</span>}
                    </span>
                    <span className="upgrade-level">
                      Niv. {u.level}{maxed ? ' (max)' : `/${def.max}`}
                      {(key === 'ouvrier' || key === 'semeur') && (u.count || 1) > 1 && (
                        <span className="worker-count-badge"> · {u.count}/{maxSlots}</span>
                      )}
                      {key === 'ouvrier' && bagSize(state, 'sacOuvrier') > 1 && (
                        <span className="worker-count-badge"> · ×{bagSize(state, 'sacOuvrier')} parcelles/action</span>
                      )}
                      {key === 'semeur' && bagSize(state, 'sacSemeur') > 1 && (
                        <span className="worker-count-badge"> · ×{bagSize(state, 'sacSemeur')} parcelles/action</span>
                      )}
                      <span className="tech-chevron">{isCollapsed ? '▸' : '▾'}</span>
                    </span>
                  </div>
                  {!isCollapsed && (
                    <>
                      <div className="upgrade-desc">{desc}</div>
                      <InvestButton maxed={maxed} afford={afford && !gated} cost={cost} onClick={() => buyUpgrade(key)} />
                      {(key === 'ouvrier' || key === 'semeur') && u.level > 0 && (u.count || 1) < maxSlots && (() => {
                        const hireCost = workerSlotCost((u.count || 1) + 1, state);
                        const canHire = state.money >= hireCost;
                        return (
                          <button
                            className={`full-btn invest-btn ${canHire ? 'on' : 'off'}`}
                            style={{ marginTop: 6, backgroundImage: `url(/sprites/${canHire ? 'btn-on' : 'btn-off'}.webp)` }}
                            onClick={() => hireWorker(key)}
                          >
                            Embaucher un {key === 'ouvrier' ? 'ouvrier' : 'semeur'} supplémentaire — {hireCost}p
                          </button>
                        );
                      })()}
                    </>
                  )}
                </div>
              );
            })}
          </Section>
        </div>

        <div className="ledger panel-col-4">
          <Section title="Statistiques" defaultCollapsed>
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
          </Section>
          <hr />
          <Section title="Classement" defaultCollapsed>
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
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, defaultCollapsed = false, children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className="ledger-section">
      <h2
        onClick={() => setCollapsed((c) => !c)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
      >
        <span>{title}</span>
        <span
          style={{
            fontSize: '0.85rem', color: 'var(--ink-soft)', fontFamily: "'Courier New', monospace",
            display: 'inline-block', transition: 'transform 0.2s ease',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
          }}
        >
          ▾
        </span>
      </h2>
      {!collapsed && children}
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '1.5rem', height: '1.5rem' }}>
      <path d="M7 10V8a5 5 0 0110 0v2h.5A1.5 1.5 0 0119 11.5v9a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20.5v-9A1.5 1.5 0 016.5 10H7zm2 0h6V8a3 3 0 00-6 0v2zm3 5a1.5 1.5 0 00-.75 2.8V19a.75.75 0 001.5 0v-1.2A1.5 1.5 0 0012 15z" />
    </svg>
  );
}

function Plot({ plot, cost, money, growTime, preview, flash, onClick, onMouseEnter, onMouseDown }) {
  const flashClass = flash === 'worker' ? 'worker-flash' : flash === 'sower' ? 'sower-flash' : '';
  const previewClass = preview ? 'harvest-preview' : '';
  if (plot.state === 'locked') {
    const affordable = money >= cost;
    return (
      <div
        className={`plot locked ${affordable ? 'affordable' : ''}`}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
      >
        <LockIcon />
        <span className="plot-price">{cost}p</span>
      </div>
    );
  }
  if (plot.state === 'empty') {
    return (
      <div
        className={`plot empty ${previewClass} ${flashClass}`}
        style={{ backgroundImage: 'url(/sprites/field-soil.webp)' }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        <span className="plot-price">{SEED_COST}p</span>
      </div>
    );
  }
  if (plot.state === 'growing') {
    const progress = Math.min(1, (Date.now() - plot.plantedAt) / (growTime * 1000));
    const sprite = progress < 0.5 ? 'field-sown' : 'field-growing';
    return (
      <div className={`plot growing ${flashClass}`} style={{ backgroundImage: `url(/sprites/${sprite}.webp)` }} onMouseEnter={onMouseEnter}>
        <span className="plot-bar"><span className="plot-bar-fill" style={{ width: `${progress * 100}%` }} /></span>
      </div>
    );
  }
  return (
    <div
      className={`plot ready ${previewClass} ${flashClass}`}
      style={{ backgroundImage: 'url(/sprites/field-ready.webp)' }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    />
  );
}

const RADIO_TRACK_NAMES = [
  'Glory To the East',
  'Glory to the Wheat',
  'Harvest for your fatherland',
  'Kids my patrie',
  'Stock up for your Motherland',
  'Symphony For Mother Wheat',
  'The great day of MotherLand',
  'The Sun always Rise at East',
  'The Walk Of The East Farmer',
];

const RADIO_VOLUME_LEVELS = ['default', '+8db', '-8db'];
// The HTML5 <audio> element only accepts a 0-1 gain, so these are a stylised
// approximation of the labelled dB steps rather than a true dB calculation.
const RADIO_VOLUME_GAIN = { default: 0.5, '+8db': 1, '-8db': 0.18 };
const RADIO_VOLUME_TEXT = { default: 'Volume normal', '+8db': '+8 dB', '-8db': '-8 dB' };

function radioTrackSrc(name, mode) {
  const fileName = mode === 'mono' ? `${name}_mono` : name;
  return `/audio/radio/${encodeURIComponent(fileName)}.mp3`;
}

function RadioWidget() {
  const [on, setOn] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [trackIdx, setTrackIdx] = useState(0);
  const [mode, setMode] = useState('stereo'); // 'stereo' | 'mono'
  const [volumeMode, setVolumeMode] = useState('default');
  const audioRef = useRef(null);

  const trackName = RADIO_TRACK_NAMES[trackIdx];
  const src = radioTrackSrc(trackName, mode);

  // Keep the element's volume in sync with the selected preset.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = RADIO_VOLUME_GAIN[volumeMode];
  }, [volumeMode]);

  // Switching track or stereo/mono mode always restarts playback from the
  // top of the new file, but only actually plays if the radio is on.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.src = src;
    el.volume = RADIO_VOLUME_GAIN[volumeMode];
    if (on) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (on) el.play().catch(() => {});
    else el.pause();
  }, [on]);

  function nextTrack() {
    setTrackIdx((i) => (i + 1) % RADIO_TRACK_NAMES.length);
  }
  function cycleVolume() {
    setVolumeMode((v) => RADIO_VOLUME_LEVELS[(RADIO_VOLUME_LEVELS.indexOf(v) + 1) % RADIO_VOLUME_LEVELS.length]);
  }

  return (
    <div className="radio-widget" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      <audio ref={audioRef} preload="auto" onEnded={() => setTrackIdx((i) => (i + 1) % RADIO_TRACK_NAMES.length)} />
      <button className="radio-mini" onClick={() => setOn((v) => !v)} title={on ? 'Éteindre la radio' : 'Allumer la radio'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sprites/radio-mini.webp" alt="Radio" />
        <span className={`radio-led ${on ? 'on' : 'off'}`} />
      </button>
      {hovering && (
        <div className="radio-popover">
          <div className="radio-full-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sprites/radio-full.webp" alt="Radio" className="radio-full-img" />
            <button className="radio-hotspot radio-hotspot-volume" onClick={cycleVolume} title={`Volume : ${RADIO_VOLUME_TEXT[volumeMode]}`} />
            <button className="radio-hotspot radio-hotspot-tuning" onClick={nextTrack} title="Changer de station" />
            <button
              className={`radio-hotspot radio-hotspot-stereo ${mode === 'stereo' ? 'active' : ''}`}
              onClick={() => setMode('stereo')}
              title="Mode stéréo"
            />
            <button
              className={`radio-hotspot radio-hotspot-mono ${mode === 'mono' ? 'active' : ''}`}
              onClick={() => setMode('mono')}
              title="Mode mono"
            />
            <div className="radio-hotspot radio-hotspot-screen" title={trackName} />
          </div>
          <div className="radio-status-line">
            {on ? 'ON' : 'OFF'} · {mode === 'stereo' ? 'Stéréo' : 'Mono'} · {RADIO_VOLUME_TEXT[volumeMode]}
          </div>
          <div className="radio-track-line">{trackName}</div>
        </div>
      )}
    </div>
  );
}

function SiloBar({ wheat, cap, bufferCap, showBuffer }) {
  const trackMax = showBuffer && bufferCap ? bufferCap : cap;
  const pctOfNominal = cap > 0 ? (wheat / cap) * 100 : 0;
  const textClass = pctOfNominal >= 90 ? 'alert' : pctOfNominal >= 70 ? 'warn' : '';
  const greenWidth = trackMax > 0 ? Math.min(100, (Math.min(wheat, cap) / trackMax) * 100) : 0;
  const overflowWidth = showBuffer && wheat > cap && trackMax > 0
    ? Math.min(100 - greenWidth, ((Math.min(wheat, trackMax) - cap) / trackMax) * 100)
    : 0;
  const markerPct = showBuffer && trackMax > 0 ? (cap / trackMax) * 100 : 100;
  return (
    <div className="silo-bar-wrap">
      <div className="silo-bar-label">Blé stocké</div>
      <div className="silo-bar-track">
        <div className="silo-bar-fill" style={{ width: `${greenWidth}%` }} />
        {overflowWidth > 0 && (
          <div className="silo-bar-overflow" style={{ left: `${greenWidth}%`, width: `${overflowWidth}%` }} />
        )}
        {showBuffer && markerPct < 100 && (
          <div className="silo-bar-marker" style={{ left: `${markerPct}%` }} title="100% de la capacité nominale" />
        )}
        <span className={`silo-bar-text ${textClass}`}>
          {wheat} / {cap}{wheat > cap ? ` (+${wheat - cap} tampon)` : ''}
        </span>
      </div>
    </div>
  );
}

function AutoTimerBar({ label, progress, colorVar, paused, onToggle }) {
  return (
    <div className={`auto-timer-row ${paused ? 'paused' : ''}`}>
      {onToggle && (
        <button
          className="worker-toggle-inline"
          onClick={onToggle}
          title={paused ? 'Réactiver' : 'Mettre en pause'}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={paused ? '/sprites/toggle-off.webp' : '/sprites/toggle-on.webp'} alt={paused ? 'En pause' : 'Actif'} />
        </button>
      )}
      <span className="field-row-label" style={{ color: `var(${colorVar})` }}>{label}</span>
      {paused ? (
        <span className="auto-timer-paused">En pause</span>
      ) : (
        <div className="auto-timer-track">
          <div className="auto-timer-fill" style={{ width: `${Math.round(progress * 100)}%`, background: `var(${colorVar})` }} />
        </div>
      )}
    </div>
  );
}

function ModeToggle({ label, value, onChange, combineLabel, combineIcon }) {
  return (
    <div className="auto-timer-row">
      <span className="field-row-label">{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className={`mode-btn ${value === 'manual' ? 'active' : ''}`}
          onClick={() => onChange('manual')}
        >
          À la main
        </button>
        <button
          className={`mode-btn ${value === 'combine' ? 'active' : ''}`}
          onClick={() => onChange('combine')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
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
  const cls = maxed ? 'maxed' : afford ? 'on' : 'off';
  return (
    <button
      className={`full-btn invest-btn ${cls}`}
      disabled={maxed}
      onClick={onClick}
      style={{ backgroundImage: `url(${sprite})` }}
    >
      {maxed ? 'Investissement maximal' : `Investir — ${cost}p`}
    </button>
  );
}

function FarmChoiceScreen({ state, onChoose, onChooseBase }) {
  const tiers = choiceTierCount(state);
  const alreadyAtBase = state.farmCols === DEFAULT_COLS && state.farmRows === DEFAULT_ROWS;
  // Skip the paid "same size" card when it would be identical to the free
  // base option below — no point offering the same 6x6 farm twice.
  const startTier = alreadyAtBase ? 1 : 0;
  return (
    <div className="field-wrap">
      <h2>Choisis ta nouvelle exploitation</h2>
      <p className="field-caption">
        Ta trésorerie actuelle finance l&rsquo;achat. L&rsquo;exploitation de départ (6×6) reste
        toujours disponible gratuitement, quoi qu&rsquo;il arrive.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
        <div
          style={{
            flex: '1 1 220px', background: 'var(--paper)', color: 'var(--ink)',
            border: '2px solid var(--gold)', borderRadius: 5, padding: '16px 18px', textAlign: 'center',
          }}
        >
          <h3 style={{ fontFamily: "'Courier New',monospace", margin: '0 0 8px', fontSize: '1rem' }}>
            Exploitation de départ
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '0 0 10px' }}>
            {DEFAULT_COLS} × {DEFAULT_ROWS} parcelles
          </p>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>
            Gratuite
          </div>
          <button className="full-btn" onClick={onChooseBase}>
            Choisir cette exploitation
          </button>
        </div>
        {Array.from({ length: Math.max(0, tiers - startTier) }, (_, i) => {
          const tier = i + startTier;
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
              <h3 style={{ fontFamily: "'Courier New',monospace", margin: '0 0 8px', fontSize: '1rem' }}>
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

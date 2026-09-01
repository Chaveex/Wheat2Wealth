// Shared game rules. Used by the client (to render and play) and, for the
// numbers that matter for fairness (costs, sell price), could also be used
// to validate moves server-side in a later pass. For this first version the
// server trusts the client's state and only persists it — see the README
// for the security tradeoffs of that choice.

export const COLS = 6;
export const ROWS = 6;
export const FREE_PLOTS = 2;
export const SELL_PRICE = 5;
export const SEED_COST = 3;

export const UPGRADE_DEFS = {
  irrigation: { max: 6, baseCost: 40, name: 'Irrigation', desc: "Réduit le temps de pousse." },
  graines: { max: 8, baseCost: 50, name: 'Graines sélectionnées', desc: 'Augmente le rendement par récolte.' },
  silo: { max: 10, baseCost: 35, name: 'Silo agrandi', desc: 'Augmente la capacité de stockage.' },
  ouvrier: { max: 5, baseCost: 70, name: 'Ouvrier agricole' },
  semeur: { max: 5, baseCost: 50, name: 'Semeur automatique' },
};

export function freshPlots() {
  const total = COLS * ROWS;
  const arr = [];
  for (let i = 0; i < total; i++) {
    arr.push({ state: i < FREE_PLOTS ? 'empty' : 'locked', plantedAt: null });
  }
  return arr;
}

export function initialState() {
  return {
    money: 15,
    wheat: 0,
    plots: freshPlots(),
    upgrades: {
      irrigation: { level: 0 },
      graines: { level: 0 },
      silo: { level: 0 },
      ouvrier: { level: 0 },
      semeur: { level: 0 },
    },
  };
}

export function ownedCount(plots) {
  return plots.filter((p) => p.state !== 'locked').length;
}

export function plotCost(plots) {
  return 20 + (ownedCount(plots) - FREE_PLOTS) * 15;
}

export function growTimeSeconds(state) {
  return Math.max(3, 12 - state.upgrades.irrigation.level * 1.5);
}

export function yieldAmount(state) {
  return 3 + state.upgrades.graines.level * 2;
}

export function siloCap(state) {
  return 40 + state.upgrades.silo.level * 20;
}

export function upgradeCost(key, level) {
  const def = UPGRADE_DEFS[key];
  return Math.round(def.baseCost * Math.pow(1.6, level));
}

// Fills in any upgrade key missing from an older save (e.g. a save made
// before "ouvrier"/"semeur" existed) so the rest of the code can always
// assume every key in UPGRADE_DEFS is present in state.upgrades.
export function normalizeState(state) {
  const upgrades = { ...state.upgrades };
  Object.keys(UPGRADE_DEFS).forEach((key) => {
    if (!upgrades[key]) upgrades[key] = { level: 0 };
  });
  return { ...state, upgrades };
}

// Both automations share the same "level -> interval" curve: no automation
// at level 0, down to one action every 2s at max level.
function autoInterval(level) {
  if (level <= 0) return null;
  return Math.max(2, 12 - (level - 1) * 2.5);
}

export function ouvrierInterval(state) {
  return autoInterval(state.upgrades.ouvrier.level);
}

export function semeurInterval(state) {
  return autoInterval(state.upgrades.semeur.level);
}

// Round-robin search starting just after `fromIdx`, so a worker sweeps the
// whole field over time instead of always finding the same low-index plot
// (which is what happens with a plain array scan when that plot keeps
// cycling back to the wanted state faster than the others get a turn).
export function findNextIndex(plots, fromIdx, predicate) {
  const n = plots.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (predicate(plots[idx])) return idx;
  }
  return -1;
}

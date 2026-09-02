// Shared game rules. Used by the client (to render and play) and, for the
// numbers that matter for fairness (costs, sell price), could also be used
// to validate moves server-side in a later pass. For this first version the
// server trusts the client's state and only persists it — see the README
// for the security tradeoffs of that choice.

export const DEFAULT_COLS = 6;
export const DEFAULT_ROWS = 6;
export const FREE_PLOTS = 2;
export const SELL_PRICE = 5;
export const SEED_COST = 3;

export const UPGRADE_DEFS = {
  irrigation: { max: 6, baseCost: 40, name: 'Irrigation', desc: "Réduit le temps de pousse." },
  graines: { max: 8, baseCost: 50, name: 'Graines sélectionnées', desc: 'Augmente le rendement par récolte.' },
  silo: { max: 10, baseCost: 35, name: 'Silo agrandi', desc: 'Augmente la capacité de stockage.' },
  ouvrier: { max: 5, baseCost: 70, name: 'Ouvrier agricole' },
  semeur: { max: 5, baseCost: 50, name: 'Semeur automatique' },
  moissonneuse: { max: 5, baseCost: 1200, name: 'Moissonneuse-batteuse' },
  semoirMeca: { max: 5, baseCost: 1200, name: 'Semoir mécanique' },
  courtier: { max: 5, baseCost: 1200, name: 'Courtier automatique' },
  sellShortcut: { max: 1, baseCost: 0, name: 'Raccourci de vente' },
};

// Unlocking the manual-sell keyboard shortcut requires having already been
// through at least one resale — it's a quality-of-life reward for sticking
// with the game, not a generation-1 basic.
export const SELL_SHORTCUT_MIN_GEN = 2;

export function sellShortcutCost(state) {
  const totalPlots = state.farmCols * state.farmRows;
  const baseSiloCap = totalPlots * 1.5; // silo capacity at level 0, before any silo upgrade
  return Math.round(baseSiloCap * SELL_PRICE * 5);
}

export function freshPlots(cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
  const total = cols * rows;
  const arr = [];
  for (let i = 0; i < total; i++) {
    arr.push({ state: i < FREE_PLOTS ? 'empty' : 'locked', plantedAt: null });
  }
  return arr;
}

export function initialState() {
  const upgrades = {};
  Object.keys(UPGRADE_DEFS).forEach((key) => { upgrades[key] = { level: 0, totalInvested: 0 }; });
  upgrades.ouvrier.count = 1;
  upgrades.ouvrier.enabled = [true];
  upgrades.semeur.count = 1;
  upgrades.semeur.enabled = [true];
  return {
    money: 15,
    wheat: 0,
    plots: freshPlots(),
    farmCols: DEFAULT_COLS,
    farmRows: DEFAULT_ROWS,
    generation: 1,
    plotsInvested: 0,
    gamePhase: 'playing', // 'playing' | 'choosing' (picking a new farm after a resale)
    settings: {
      sellShortcutEnabled: true,
    },
    upgrades,
    stats: {
      totalEarned: 0,
      totalSpent: 0,
      totalWheatSold: 0,
      totalWheatHarvested: 0,
      totalWheatLost: 0,
      salesCount: 0,
      startedAt: Date.now(),
      recentSales: [], // [{t, amount}], used for the live p/s indicator
    },
  };
}

// Fills in anything missing from an older save (a save made before a given
// feature existed) so the rest of the code can always assume the full shape
// of `initialState()` is present.
export function normalizeState(state) {
  const upgrades = { ...state.upgrades };
  Object.keys(UPGRADE_DEFS).forEach((key) => {
    if (!upgrades[key]) upgrades[key] = { level: 0, totalInvested: 0 };
    else if (typeof upgrades[key].totalInvested !== 'number') upgrades[key] = { ...upgrades[key], totalInvested: 0 };
  });
  if (typeof upgrades.ouvrier.count !== 'number') upgrades.ouvrier = { ...upgrades.ouvrier, count: 1 };
  if (typeof upgrades.semeur.count !== 'number') upgrades.semeur = { ...upgrades.semeur, count: 1 };
  // Pad/create the per-worker enabled flags so their length always matches
  // `count`, defaulting any missing entry to enabled (true).
  ['ouvrier', 'semeur'].forEach((key) => {
    const u = upgrades[key];
    const enabled = Array.isArray(u.enabled) ? u.enabled.slice() : [];
    while (enabled.length < (u.count || 1)) enabled.push(true);
    upgrades[key] = { ...u, enabled };
  });
  const defaultStats = initialState().stats;
  return {
    ...state,
    farmCols: state.farmCols ?? DEFAULT_COLS,
    farmRows: state.farmRows ?? DEFAULT_ROWS,
    generation: state.generation ?? 1,
    plotsInvested: state.plotsInvested ?? 0,
    gamePhase: state.gamePhase ?? 'playing',
    settings: { sellShortcutEnabled: true, ...(state.settings || {}) },
    upgrades,
    stats: { ...defaultStats, ...(state.stats || {}), startedAt: state.stats?.startedAt ?? Date.now() },
  };
}

export function ownedCount(plots) {
  return plots.filter((p) => p.state !== 'locked').length;
}

// Each generation makes land and upgrades 25% more expensive than the one
// before it — the tradeoff for the +10% efficiency in genPowerMult().
export function genCostMult(state) {
  return Math.pow(1.25, state.generation - 1);
}

export function genPowerMult(state) {
  return Math.pow(1.10, state.generation - 1);
}

export function plotCost(plots, state) {
  return Math.round((20 + (ownedCount(plots) - FREE_PLOTS) * 15) * genCostMult(state));
}

export function growTimeSeconds(state) {
  return Math.max(3, (12 - state.upgrades.irrigation.level * 1.5) / genPowerMult(state));
}

export function yieldAmount(state) {
  return Math.round((3 + state.upgrades.graines.level * 2) * genPowerMult(state));
}

export function siloCap(state) {
  const totalPlots = state.farmCols * state.farmRows;
  return Math.round((totalPlots * 1.5 + state.upgrades.silo.level * 20) * genPowerMult(state));
}

// --- Fill bonus & silo buffer (unlocked at generation 3) ---
// A near-full silo earns a bonus on every unit sold, on a deliberately
// asymmetric curve: small at half-full, and only really taking off in the
// last stretch before 100% — rewarding a player willing to babysit the
// silo and time a manual sale, far more than the courtier's fixed 90%
// trigger ever can. Interpolated directly from the agreed reference table
// rather than forced onto a single exponential, so it hits those numbers
// exactly and stays easy to retune.
export const FILL_BONUS_MIN_GEN = 3;
export const SILO_BUFFER_MULT = 1.10;

const FILL_BONUS_POINTS = [
  [0, 0],
  [0.5, 0.02],
  [0.75, 0.05],
  [0.90, 0.10],
  [0.98, 0.20],
  [1.10, 0.20],
];

export function fillBonusPct(fillRatio) {
  const r = Math.max(0, Math.min(1.10, fillRatio));
  for (let i = 0; i < FILL_BONUS_POINTS.length - 1; i++) {
    const [x0, y0] = FILL_BONUS_POINTS[i];
    const [x1, y1] = FILL_BONUS_POINTS[i + 1];
    if (r <= x1) {
      const t = x1 === x0 ? 1 : (r - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return FILL_BONUS_POINTS[FILL_BONUS_POINTS.length - 1][1];
}

// The real ceiling before wheat is actually destroyed: 110% of nominal
// capacity from generation 3 onward (a few seconds' grace to react), the
// plain nominal capacity before that.
export function siloEffectiveCap(state) {
  const nominal = siloCap(state);
  return state.generation >= FILL_BONUS_MIN_GEN ? Math.round(nominal * SILO_BUFFER_MULT) : nominal;
}

// The bonus a sale would currently earn, 0 before generation 3.
export function currentFillBonus(state) {
  if (state.generation < FILL_BONUS_MIN_GEN) return 0;
  const cap = siloCap(state);
  if (cap <= 0) return 0;
  return fillBonusPct(state.wheat / cap);
}

export function upgradeCost(key, level, state) {
  const def = UPGRADE_DEFS[key];
  return Math.round(def.baseCost * Math.pow(1.6, level) * genCostMult(state));
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

// Extra workers, beyond the one that comes with the base upgrade: priced
// off the farm's average income so hiring one always costs a real chunk of
// playtime (roughly 2 minutes of p/s for the 2nd, doubling after that),
// rather than a flat number that trivializes at scale.
export function avgIncomePerSecond(state) {
  const elapsedSec = Math.max((Date.now() - state.stats.startedAt) / 1000, 1);
  return state.stats.totalEarned / elapsedSec;
}

export function workerSlotCost(n, state) {
  // n is the 1-indexed slot being hired (2, 3, 4...) — slot 1 is free,
  // already covered by the base "Ouvrier agricole" / "Semeur automatique".
  const avgPS = avgIncomePerSecond(state);
  const baseCost = Math.max(50, Math.round(120 * avgPS));
  return Math.round(baseCost * Math.pow(2, Math.max(0, n - 2)));
}

// How many worker slots (hired or not) the current farm generation allows.
// Resets to 1 on every resale, then grows by one per generation, giving the
// same "rebuild, but with a higher ceiling" shape as the rest of prestige.
export function maxWorkerSlots(state) {
  return state.generation;
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

// --- Machines (moissonneuse / semoir mécanique / courtier) ---
// Unlocking the first level of either field machine requires having already
// filled 4 full rows or 4 full columns of plots — a proof the farm is big
// enough to be worth mechanising, not just money in the bank.
export function meets4LinesRequirement(plots, cols, rows) {
  let fullRows = 0;
  let fullCols = 0;
  for (let r = 0; r < rows; r++) {
    let full = true;
    for (let c = 0; c < cols; c++) {
      if (plots[r * cols + c].state === 'locked') { full = false; break; }
    }
    if (full) fullRows++;
  }
  for (let c = 0; c < cols; c++) {
    let full = true;
    for (let r = 0; r < rows; r++) {
      if (plots[r * cols + c].state === 'locked') { full = false; break; }
    }
    if (full) fullCols++;
  }
  return fullRows >= 4 || fullCols >= 4;
}

// The whole row a machine acts on, anchored at `i` (any plot in that row
// triggers the same full-row action).
export function getRowBlock(i, cols) {
  const row = Math.floor(i / cols);
  const start = row * cols;
  return Array.from({ length: cols }, (_, c) => start + c);
}

const MACHINE_BASE_PENALTY = 0.15;

// Combine harvester: -15% yield at level 1, tapering to 0% at max level —
// using it is always at least as fast as manual, but manual stays the more
// efficient choice until this is fully upgraded.
export function moissonneusePenalty(state) {
  const lvl = state.upgrades.moissonneuse.level;
  const max = UPGRADE_DEFS.moissonneuse.max;
  if (lvl <= 0) return 0;
  const step = MACHINE_BASE_PENALTY / (max - 1);
  return Math.max(0, MACHINE_BASE_PENALTY - (lvl - 1) * step);
}

// Mechanical seeder: same curve, but as a chance the seed (already paid
// for) simply fails to take, rather than a yield cut.
export function semoirMecaFailChance(state) {
  const lvl = state.upgrades.semoirMeca.level;
  const max = UPGRADE_DEFS.semoirMeca.max;
  if (lvl <= 0) return 0;
  const step = MACHINE_BASE_PENALTY / (max - 1);
  return Math.max(0, MACHINE_BASE_PENALTY - (lvl - 1) * step);
}

export const COURTIER_BASE_TAX = 0.10;
export const COURTIER_MIN_TAX = 0.03;
export const COURTIER_THRESHOLD = 0.9;

// Automatic broker: sells everything once the silo crosses 90% full, for a
// fee that never reaches zero — selling by hand always stays the more
// profitable option for a player optimising to the last percent.
export function courtierTax(state) {
  const lvl = state.upgrades.courtier.level;
  const max = UPGRADE_DEFS.courtier.max;
  if (lvl <= 0) return 0;
  const step = (COURTIER_BASE_TAX - COURTIER_MIN_TAX) / (max - 1);
  return Math.max(COURTIER_MIN_TAX, COURTIER_BASE_TAX - (lvl - 1) * step);
}

// Sprite paths (files live in /public/sprites). Level is clamped to the
// [1,5] range so the upgrade card can preview the level-1 look before it's
// even bought.
export function harvesterSprite(level) {
  return `/sprites/harvester-${Math.min(5, Math.max(1, level))}.webp`;
}

export function seederSprite(level) {
  return `/sprites/seeder-${Math.min(5, Math.max(1, level))}.webp`;
}

// --- Resale / new-farm system ("prestige") ---
const TECH_RESALE_RATE = 0.4;
const BIGGER_TIER_CAP = 6; // never offer more than this many size choices at once

// What selling the whole farm gets you back: 40% of everything ever spent
// on plots and on upgrade levels, plus the wheat currently in the silo at
// the normal sell price.
export function computeResaleValue(state) {
  const plotsValue = (state.plotsInvested || 0) * TECH_RESALE_RATE;
  let techsValue = 0;
  Object.values(state.upgrades).forEach((u) => { techsValue += (u.totalInvested || 0) * TECH_RESALE_RATE; });
  const wheatValue = state.wheat * SELL_PRICE;
  return Math.round(plotsValue + techsValue + wheatValue);
}

function plotsCostForSize(cols, rows) {
  const total = cols * rows;
  let sum = 0;
  for (let n = FREE_PLOTS; n < total; n++) sum += 20 + (n - FREE_PLOTS) * 15;
  return sum;
}

// Cost of a fresh farm at the same size: land plus a basic (level-1) copy of
// every upgrade — a real but modest number, meant as the affordable
// fallback for a player who didn't do well this generation.
export function rebuildCost(cols, rows, state) {
  let sum = plotsCostForSize(cols, rows);
  Object.values(UPGRADE_DEFS).forEach((def) => { sum += def.baseCost; });
  return Math.round(sum * genCostMult(state));
}

// Cost of a bigger farm: land only, at the new (larger) size. No technology
// component on purpose — see design discussion: it keeps the size jump a
// real but not artificially multiplied cost, while still costing more than
// the same-size option simply because there's more land to price in.
export function biggerFarmCost(cols, rows, state) {
  return Math.round(plotsCostForSize(cols, rows) * genCostMult(state));
}

// Number of size choices offered on the "pick a new farm" screen: 2 the
// first time (same size, +1/+1), growing by one per generation so a
// well-off player can aim further ahead instead of always taking one small
// step, capped so the screen stays readable.
export function choiceTierCount(state) {
  return Math.min(BIGGER_TIER_CAP, Math.max(2, state.generation));
}

export function choiceTierCost(tier, state) {
  const cols = state.farmCols + tier;
  const rows = state.farmRows + tier;
  return tier === 0 ? rebuildCost(cols, rows, state) : biggerFarmCost(cols, rows, state);
}

export function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

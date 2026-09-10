// Crée (ou met à jour) un compte de test avec une sauvegarde de partie déjà
// avancée, directement dans Supabase — pour que Claude Code (ou toi) puisse
// se connecter avec des identifiants connus et atterrir immédiatement dans
// un état de jeu représentatif (génération 4, plusieurs employés, quelques
// niveaux de technos), sans avoir à créer un compte à la main ni attendre en
// temps réel pour atteindre ce point.
//
// Usage (depuis la racine du projet, avec les dépendances déjà installées
// via `npm install`) :
//
//   node --env-file=.env.local scripts/seed-test-account.mjs
//
// Identifiants personnalisables via variables d'environnement :
//   SEED_USERNAME=MonBot SEED_PASSWORD=motdepasse123 node --env-file=.env.local scripts/seed-test-account.mjs
//
// Ce script utilise les mêmes SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY que
// l'application elle-même (celles de ton .env.local) — jamais de clé
// publique, jamais à committer avec de vraies valeurs en dur.

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY manquants.\n' +
    'Lance ce script avec : node --env-file=.env.local scripts/seed-test-account.mjs'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const USERNAME = process.env.SEED_USERNAME || 'PlaytestBot';
const PASSWORD = process.env.SEED_PASSWORD || 'test1234';

function freshPlots(cols, rows) {
  const total = cols * rows;
  const arr = [];
  for (let i = 0; i < total; i++) {
    arr.push({ state: i < 2 ? 'empty' : 'locked', plantedAt: null });
  }
  return arr;
}

// Un état "génération 4, exploitation établie" — pensé pour pouvoir tester
// directement ce qui se débloque en gen 2 (2e employé, raccourci Espace),
// gen 3 (bonus de remplissage du silo) et gen 4 (sac multi-parcelles niveau
// 2), sans avoir à faire progresser une partie depuis zéro.
const FARM_COLS = 9;
const FARM_ROWS = 9;

const testState = {
  money: 5000,
  wheat: 0,
  plots: freshPlots(FARM_COLS, FARM_ROWS),
  farmCols: FARM_COLS,
  farmRows: FARM_ROWS,
  generation: 4,
  plotsInvested: 3000,
  gamePhase: 'playing',
  settings: { sellShortcutEnabled: true },
  upgrades: {
    irrigation: { level: 3, totalInvested: 300 },
    graines: { level: 3, totalInvested: 400 },
    silo: { level: 3, totalInvested: 250 },
    ouvrier: { level: 2, count: 2, enabled: [true, true], totalInvested: 500 },
    semeur: { level: 2, count: 2, enabled: [true, true], totalInvested: 400 },
    moissonneuse: { level: 0, totalInvested: 0 },
    semoirMeca: { level: 0, totalInvested: 0 },
    courtier: { level: 1, totalInvested: 1200 },
    sellShortcut: { level: 0, totalInvested: 0 },
    sacOuvrier: { level: 0, totalInvested: 0 },
    sacSemeur: { level: 0, totalInvested: 0 },
  },
  stats: {
    totalEarned: 8000,
    totalSpent: 3000,
    totalWheatSold: 1200,
    totalWheatHarvested: 1300,
    totalWheatLost: 20,
    salesCount: 40,
    startedAt: Date.now() - 1000 * 60 * 30, // 30 min de "temps de jeu" pour des stats p/s réalistes
    recentSales: [],
  },
};

async function main() {
  const password_hash = await bcrypt.hash(PASSWORD, 10);

  const { data: existing, error: lookupError } = await supabase
    .from('accounts')
    .select('id')
    .ilike('username', USERNAME)
    .maybeSingle();

  if (lookupError) throw lookupError;

  let accountId;
  if (existing) {
    accountId = existing.id;
    const { error: updateError } = await supabase
      .from('accounts')
      .update({ password_hash })
      .eq('id', accountId);
    if (updateError) throw updateError;
    console.log(`Compte existant "${USERNAME}" retrouvé, mot de passe réinitialisé.`);
  } else {
    const { data: created, error: insertError } = await supabase
      .from('accounts')
      .insert({ username: USERNAME, password_hash })
      .select()
      .single();
    if (insertError) throw insertError;
    accountId = created.id;
    console.log(`Compte "${USERNAME}" créé.`);
  }

  const { error: saveError } = await supabase
    .from('saves')
    .upsert(
      { account_id: accountId, state: testState, best_score: testState.money },
      { onConflict: 'account_id' }
    );
  if (saveError) throw saveError;

  console.log('Sauvegarde de test injectée avec succès.');
  console.log('');
  console.log('Identifiants à donner à Claude Code :');
  console.log(`  Pseudo       : ${USERNAME}`);
  console.log(`  Mot de passe : ${PASSWORD}`);
}

main().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});

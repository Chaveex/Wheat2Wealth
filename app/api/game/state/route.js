import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession } from '@/lib/getSession';

// Generous anti-cheat ceiling: even a maxed-out, multi-generation farm with
// bag-equipped workers dumping a full silo via a burst sale shouldn't
// plausibly clear more than this per second. It's deliberately loose — the
// goal is to block "20 million in one request", not to police normal play
// down to the last percent. Tune this up if legitimate late-game players
// ever get clamped.
const MAX_PLAUSIBLE_INCOME_PER_SEC = 4000;
const BURST_SAFETY_BUFFER = 5000; // covers one-off bag/courtier/fill-bonus bursts
const MIN_ELAPSED_SECONDS = 1;
const STARTING_MONEY = 15;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('saves')
    .select('state, best_score')
    .eq('account_id', session.accountId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ state: data.state, bestScore: Number(data.best_score) });
}

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const state = body.state;
  if (!state || typeof state !== 'object' || typeof state.money !== 'number' || !Number.isFinite(state.money)) {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('saves')
    .select('state, best_score, updated_at')
    .eq('account_id', session.accountId)
    .maybeSingle();

  const previousMoney = typeof existing?.state?.money === 'number' ? existing.state.money : STARTING_MONEY;
  const previousBest = existing ? Number(existing.best_score) || 0 : 0;
  const elapsedSeconds = existing?.updated_at
    ? Math.max(MIN_ELAPSED_SECONDS, (Date.now() - new Date(existing.updated_at).getTime()) / 1000)
    : MIN_ELAPSED_SECONDS;

  // A save can never plausibly show more money than "what you had, plus the
  // most anyone could realistically earn in the time since your last save".
  const maxPlausibleMoney = previousMoney + elapsedSeconds * MAX_PLAUSIBLE_INCOME_PER_SEC + BURST_SAFETY_BUFFER;

  let flagged = false;
  let safeMoney = state.money;
  if (safeMoney > maxPlausibleMoney) {
    safeMoney = maxPlausibleMoney;
    flagged = true;
  }

  const safeState = safeMoney === state.money ? state : { ...state, money: safeMoney };

  // The client's own `bestScore` field is never trusted — the server always
  // derives it from the validated money, so a direct "just tell the server
  // my score is 20 million" request has no effect at all.
  const bestScore = Math.max(previousBest, safeMoney);

  const { error } = await supabaseAdmin
    .from('saves')
    .upsert(
      {
        account_id: session.accountId,
        state: safeState,
        best_score: bestScore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );

  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  return NextResponse.json({ ok: true, flagged });
}

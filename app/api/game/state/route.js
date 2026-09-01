import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession } from '@/lib/getSession';

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
  if (!state || typeof state !== 'object') {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }
  const bestScore = typeof body.bestScore === 'number' ? body.bestScore : 0;

  const { error } = await supabaseAdmin
    .from('saves')
    .upsert(
      {
        account_id: session.accountId,
        state,
        best_score: bestScore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );

  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('saves')
    .select('best_score, accounts(username)')
    .order('best_score', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  const entries = (data || []).map((row) => ({
    username: row.accounts?.username || '???',
    bestScore: Number(row.best_score),
  }));

  return NextResponse.json({ entries });
}

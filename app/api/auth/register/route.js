import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createSessionToken } from '@/lib/session';
import { initialState } from '@/lib/gameLogic';

const NAME_RE = /^[\p{L}\p{N} _-]+$/u;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (username.length < 3 || username.length > 16 || !NAME_RE.test(username)) {
    return NextResponse.json({ error: 'invalid_username' }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('accounts')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  if (lookupError) {
    console.error('register lookupError:', lookupError);
    return NextResponse.json({ error: 'server_error', detail: lookupError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: 'username_taken' }, { status: 409 });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data: account, error: insertError } = await supabaseAdmin
    .from('accounts')
    .insert({ username, password_hash })
    .select()
    .single();

  if (insertError) {
    console.error('register insertError:', insertError);
    return NextResponse.json({ error: 'server_error', detail: insertError.message }, { status: 500 });
  }

  const { error: saveError } = await supabaseAdmin
    .from('saves')
    .insert({ account_id: account.id, state: initialState(), best_score: 0 });

  if (saveError) {
    console.error('register saveError:', saveError);
    return NextResponse.json({ error: 'server_error', detail: saveError.message }, { status: 500 });
  }

  const token = createSessionToken({ accountId: account.id, username: account.username });
  const cookieStore = await cookies();
  cookieStore.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ username: account.username });
}

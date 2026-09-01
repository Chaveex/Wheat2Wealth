import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createSessionToken } from '@/lib/session';

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, username, password_hash')
    .ilike('username', username)
    .maybeSingle();

  if (error) {
    console.error('login lookupError:', error);
    return NextResponse.json({ error: 'server_error', detail: error.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
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

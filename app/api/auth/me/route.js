import { NextResponse } from 'next/server';
import { getSession } from '@/lib/getSession';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ loggedIn: false });
  return NextResponse.json({ loggedIn: true, username: session.username });
}

import { cookies } from 'next/headers';
import { verifySessionToken } from './session';

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  return verifySessionToken(token);
}

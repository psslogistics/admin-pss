import { NextResponse } from 'next/server';
export async function POST() { const response = NextResponse.json({ ok: true }); response.cookies.set('pss_password_recovery', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/reset-password' }); return response; }

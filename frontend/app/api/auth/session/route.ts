import { NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/firebase-session";

type FirebaseAccountLookupResponse = {
  users?: Array<{
    localId?: string;
  }>;
};

export async function POST(request: Request) {
  const { idToken } = (await request.json()) as { idToken?: unknown };

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "A Firebase ID token is required." }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Firebase is not configured." }, { status: 500 });
  }

  const firebaseResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      body: JSON.stringify({ idToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!firebaseResponse.ok) {
    return NextResponse.json({ error: "Invalid Firebase ID token." }, { status: 401 });
  }

  const account = (await firebaseResponse.json()) as FirebaseAccountLookupResponse;
  const uid = account.users?.[0]?.localId;
  const tokenPayload = JSON.parse(
    Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
  ) as { exp?: unknown };

  if (!uid || typeof tokenPayload.exp !== "number") {
    return NextResponse.json({ error: "Invalid Firebase ID token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSession({ exp: tokenPayload.exp, uid }), {
    httpOnly: true,
    maxAge: Math.max(0, tokenPayload.exp - Math.floor(Date.now() / 1000)),
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

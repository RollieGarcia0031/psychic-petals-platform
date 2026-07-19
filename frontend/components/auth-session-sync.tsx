"use client";

import { useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

async function syncSession(idToken?: string) {
  const response = await fetch("/api/auth/session", {
    body: idToken ? JSON.stringify({ idToken }) : undefined,
    headers: idToken ? { "Content-Type": "application/json" } : undefined,
    method: idToken ? "POST" : "DELETE",
  });

  if (!response.ok) {
    throw new Error("Unable to create an authenticated session.");
  }
}

export function AuthSessionSync() {
  useEffect(() => {
    return onIdTokenChanged(auth, (user) => {
      void (async () => {
        await syncSession(user ? await user.getIdToken() : undefined);
      })().catch(console.error);
    });
  }, []);

  return null;
}

export { syncSession };

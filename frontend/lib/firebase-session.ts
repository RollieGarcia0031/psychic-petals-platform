type SessionPayload = {
  exp: number;
  uid: string;
};

const SESSION_COOKIE = "firebase_session";
const textEncoder = new TextEncoder();

function getSessionSecret() {
  const secret = process.env.FIREBASE_SESSION_SECRET;

  if (!secret) {
    throw new Error("FIREBASE_SESSION_SECRET is not configured.");
  }

  return secret;
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(getSessionSecret()),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(payload: SessionPayload) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(),
    textEncoder.encode(encodedPayload),
  );

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(session: string | undefined) {
  if (!session) {
    return null;
  }

  const [encodedPayload, encodedSignature, ...rest] = session.split(".");

  if (!encodedPayload || !encodedSignature || rest.length > 0) {
    return null;
  }

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      decodeBase64Url(encodedSignature),
      textEncoder.encode(encodedPayload),
    );

    if (!valid) {
      return null;
    }

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as SessionPayload;

    return payload.exp > Math.floor(Date.now() / 1000) && payload.uid ? payload : null;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };

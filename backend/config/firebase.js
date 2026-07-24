import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

function getServiceAccountCredential() {
  const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!encodedKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain Base64-encoded Firebase service-account JSON.');
  }

  try {
    const serviceAccount = JSON.parse(
      Buffer.from(encodedKey.replace(/\s/g, ''), 'base64').toString('utf8'),
    );
    return cert(serviceAccount);
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY is not valid Base64-encoded service-account JSON: ${error.message}`);
  }
}

const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp({ credential: getServiceAccountCredential() });

export const db = getFirestore(app);

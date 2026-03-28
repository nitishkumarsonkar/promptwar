import * as admin from 'firebase-admin';

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'prompt-war-project',
    });
  }
} catch (error) {
  console.error('[Firebase Admin] Initialization error', error);
}

// Return null cleanly if initialization failed or no creds in non-GCP environment
export const db = admin.apps.length ? admin.firestore() : null;

// Returns decoded ID token payload, or null if unverified / invalid
export async function verifyIdToken(token: string) {
  if (!admin.apps.length) return null;
  try {
     return await admin.auth().verifyIdToken(token);
  } catch (err) {
     return null;
  }
}


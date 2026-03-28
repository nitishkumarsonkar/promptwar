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

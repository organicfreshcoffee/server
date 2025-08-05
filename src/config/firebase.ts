import * as admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let firebaseApp: admin.app.App | null = null;

export async function initializeFirebase(): Promise<admin.app.App> {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Initialize Secret Manager client
    const secretClient = new SecretManagerServiceClient();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    
    if (!projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required');
    }

    // Retrieve Firebase service account from Secret Manager
    const [serviceAccountResponse] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/firebase-service-account/versions/latest`,
    });

    const serviceAccountPayload = serviceAccountResponse.payload?.data?.toString();
    if (!serviceAccountPayload) {
      throw new Error('Failed to retrieve Firebase service account from Secret Manager');
    }

    const serviceAccount = JSON.parse(serviceAccountPayload);

    // Initialize Firebase Admin SDK
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    throw error;
  }
}

export function getFirebaseApp(): admin.app.App {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return firebaseApp;
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  try {
    const app = getFirebaseApp();
    const decodedToken = await app.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Token verification error:', error);
    throw new Error('Invalid authentication token');
  }
}

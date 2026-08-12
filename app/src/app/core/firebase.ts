import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

export function isFirebaseConfigured(): boolean {
  return Boolean(environment.firebase.apiKey && environment.firebase.projectId);
}

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let auth: Auth | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!app) {
    app = initializeApp(environment.firebase);
  }
  return app;
}

export function getDb(): Firestore | null {
  const instance = getFirebaseApp();
  if (!instance) {
    return null;
  }
  if (!firestore) {
    firestore = getFirestore(instance);
  }
  return firestore;
}

export function getAuthInstance(): Auth | null {
  const instance = getFirebaseApp();
  if (!instance) {
    return null;
  }
  if (!auth) {
    auth = getAuth(instance);
  }
  return auth;
}

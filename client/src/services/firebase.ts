import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';

const firebaseConfig = {
  projectId: 'supa-juka',
  appId: '1:328453931925:web:14fbdedd4b806fe387ac9c',
  storageBucket: 'supa-juka.firebasestorage.app',
  apiKey: 'AIzaSyBDeDLI_n4IrIcNMaKErgvEsZYUY3UOGoE',
  authDomain: 'supa-juka.firebaseapp.com',
  messagingSenderId: '328453931925',
  measurementId: 'G-JSZXMRXY1Q',
};

// Initialize Firebase App singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Trigger Google OAuth Popup
 * Automatically adds the user to Firebase Auth table & local lead register
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const u = result.user;

  try {
    const lead = {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      photoURL: u.photoURL,
      signedUpAt: u.metadata?.creationTime || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      source: 'supajuka-web-app',
    };
    localStorage.setItem(`supajuka_lead_${u.uid}`, JSON.stringify(lead));
  } catch (err) {
    console.warn('Could not cache user lead locally:', err);
  }

  return u;
}

/**
 * Sign out current user
 */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribe to authentication state changes
 */
export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export type { User };

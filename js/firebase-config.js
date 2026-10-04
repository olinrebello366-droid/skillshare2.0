

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import { getFunctions } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

// Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyCVQgyTSazntRK6cQPoD0DwoVbQiDeQqok",
  authDomain: "skillshare-2-0.firebaseapp.com",
  projectId: "skillshare-2-0",
  storageBucket: "skillshare-2-0.firebasestorage.app",
  messagingSenderId: "766943218181",
  appId: "1:766943218181:web:ae9a0e797cb6ac626dea6c"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Authentication
export const auth = getAuth(app);

// Keep users logged in across browser sessions
export const authReady = setPersistence(
  auth,
  browserLocalPersistence
);

// Initialize Firestore Database
export const db = getFirestore(app);

// Cloud Functions region
export const FUNCTIONS_REGION = "asia-south1";

export const functions = getFunctions(
  app,
  FUNCTIONS_REGION
);

// Firebase is configured
export const isConfigured = true;


// Handles the login and register forms.
import { auth, authReady } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { configWarning, setBusy } from "./common.js";

configWarning();

const ERRORS = {
  "auth/email-already-in-use": "That email is already registered. Try logging in instead.",
  "auth/invalid-email": "That email address does not look right.",
  "auth/weak-password": "Choose a stronger password (at least 8 characters).",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Network problem. Check your internet connection.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase is not configured. Check js/firebase-config.js.",
  "auth/invalid-api-key": "Firebase is not configured. Check js/firebase-config.js.",
};

function showError(message) {
  const el = document.getElementById("formError");
  el.textContent = message;
  el.hidden = !message;
}

// ---------------- Login ----------------
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  onAuthStateChanged(auth, (user) => { if (user) location.href = "dashboard.html"; });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const btn = loginForm.querySelector("button[type=submit]");
    setBusy(btn, true, "Logging in...");
    try {
await authReady;

      await signInWithEmailAndPassword(auth, loginForm.email.value.trim(),
       loginForm.password.value);
      location.href = "dashboard.html";
    } catch (err) {
      showError(ERRORS[err.code] || err.message);
      setBusy(btn, false);
    }
  });
}

// ---------------- Register ----------------
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const name = registerForm.fullName.value.trim();
    const email = registerForm.email.value.trim();
    const password = registerForm.password.value;
    const confirm = registerForm.confirmPassword.value;

    if (name.length < 2) return showError("Please enter your full name.");
    if (password.length < 8) return showError("Password must be at least 8 characters.");
    if (password !== confirm) return showError("The two passwords do not match.");

    const btn = registerForm.querySelector("button[type=submit]");
    setBusy(btn, true, "Creating account...");
    try {
await authReady;

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      location.href = "profile-setup.html";
    } catch (err) {
      showError(ERRORS[err.code] || err.message);
      setBusy(btn, false);
    }
  });
}

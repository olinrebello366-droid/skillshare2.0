// Shared helpers used by every page: login guard, navigation bar, small utilities.
import { auth, db, functions, isConfigured } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

export const DEFAULT_LEVELS = [0, 100, 300, 600, 1000];

// ---------- text helpers ----------
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function avatar(name, size = "md") {
  return `<span class="avatar avatar-${size}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// Connection ids are the two user ids, sorted, joined by "_".
export function pairKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ---------- dates ----------
export function tsToDate(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
}

export function fmtDateTime(d) {
  if (!d) return "";
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

// ---------- levels ----------
export function levelFromXp(xp, thresholds = DEFAULT_LEVELS) {
  let level = 1;
  thresholds.forEach((t, i) => { if (xp >= t) level = i + 1; });
  return level;
}

export function levelProgress(xp, thresholds = DEFAULT_LEVELS) {
  const level = levelFromXp(xp, thresholds);
  const current = thresholds[level - 1];
  const next = thresholds[level];
  if (next === undefined) return { level, pct: 100, label: `${xp} XP · max level` };
  const pct = Math.max(0, Math.min(100, Math.round(((xp - current) / (next - current)) * 100)));
  return { level, pct, label: `${xp} / ${next} XP` };
}

export async function getThresholds() {
  try {
    const snap = await getDoc(doc(db, "config", "levels"));
    if (snap.exists() && Array.isArray(snap.data().thresholds)) return snap.data().thresholds;
  } catch (e) { /* use defaults */ }
  return DEFAULT_LEVELS;
}

// ---------- UI helpers ----------
export function toast(message, type = "info") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

export function showError(error, fallback = "Something went wrong.") {
  console.error(error);
  const code = error?.code || "";
  if (code.includes("permission-denied")) {
    toast("Permission denied. Check that firestore.rules is deployed.", "error");
  } else {
    toast(error?.message || fallback, "error");
  }
}

export function setBusy(button, busy, busyText = "Please wait...") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

// Calls a Cloud Function and returns its result (throws a readable Error on failure).
export async function callFn(name, data) {
  try {
    const result = await httpsCallable(functions, name)(data);
    return result.data;
  } catch (e) {
    const msg = e?.code === "functions/not-found" || e?.code === "functions/internal"
      ? "Cloud Functions are not deployed yet. See README step 7."
      : e?.message || "Something went wrong.";
    throw new Error(msg);
  }
}

// ---------- login guard + navigation ----------
export function requireUser({ needProfile = true } = {}) {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (!user) { location.href = "login.html"; return; }
      let profile = null;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        profile = snap.exists() ? snap.data() : null;
      } catch (e) {
        showError(e);
      }
      if (needProfile && !(profile && profile.profileComplete)) {
        location.href = "profile-setup.html";
        return;
      }
      renderNav(user, profile);
      resolve({ user, profile });
    });
  });
}

function renderNav(user, profile) {
  const nav = document.getElementById("siteNav");
  if (!nav) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const links = [
    ["dashboard.html", "Dashboard"],
    ["explore.html", "Explore"],
    ["connections.html", "Connections"],
    ["sessions.html", "Sessions"],
    ["chat.html", "Chat"],
    ["profile-setup.html", "My profile"],
  ];
  nav.innerHTML = `
    <div class="container nav-inner">
      <a class="brand" href="dashboard.html">Skill<span>Share</span> 2.0</a>
      <button class="nav-toggle" id="navToggle" aria-label="Open menu" aria-expanded="false">Menu</button>
      <nav class="nav-links" id="navLinks">
        ${links.map(([href, label]) => `<a href="${href}" class="${page === href ? "active" : ""}">${label}</a>`).join("")}
        <button class="btn btn-ghost btn-sm" id="logoutBtn" type="button">Log out</button>
      </nav>
    </div>`;
  document.getElementById("navToggle").addEventListener("click", (e) => {
    const open = document.getElementById("navLinks").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "index.html";
  });

  if (!isConfigured) {
    const banner = document.createElement("div");
    banner.className = "config-banner";
    banner.textContent = "Firebase is not configured yet. Open js/firebase-config.js and paste your project settings.";
    document.body.prepend(banner);
  }
}

export function configWarning() {
  if (!isConfigured) {
    const banner = document.createElement("div");
    banner.className = "config-banner";
    banner.textContent = "Firebase is not configured yet. Open js/firebase-config.js and paste your project settings.";
    document.body.prepend(banner);
  }
}

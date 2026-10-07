// Shared helpers used by every page: login guard, navigation, small utilities.

import { auth, db, functions, isConfigured } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";


// =========================================================
// LEVEL SYSTEM
// =========================================================

export const DEFAULT_LEVELS = [
  0,
  100,
  300,
  600,
  1000
];


// =========================================================
// TEXT HELPERS
// =========================================================

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


export function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    (parts[0]?.[0] || "?") +
    (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}


export function avatar(name, size = "md") {
  return `
    <span class="avatar avatar-${size}" aria-hidden="true">
      ${esc(initials(name))}
    </span>
  `;
}


// =========================================================
// CONNECTION HELPERS
// =========================================================

export function pairKey(a, b) {
  return a < b
    ? `${a}_${b}`
    : `${b}_${a}`;
}


// =========================================================
// DATE HELPERS
// =========================================================

export function tsToDate(ts) {
  if (!ts) return null;

  return typeof ts.toDate === "function"
    ? ts.toDate()
    : new Date(ts);
}


export function fmtDateTime(d) {
  if (!d) return "";

  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}


export function fmtDate(d) {
  if (!d) return "";

  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}


// =========================================================
// LEVEL HELPERS
// =========================================================

export function levelFromXp(
  xp,
  thresholds = DEFAULT_LEVELS
) {
  let level = 1;

  thresholds.forEach((threshold, index) => {
    if (xp >= threshold) {
      level = index + 1;
    }
  });

  return level;
}


export function levelProgress(
  xp,
  thresholds = DEFAULT_LEVELS
) {
  const level = levelFromXp(
    xp,
    thresholds
  );

  const current =
    thresholds[level - 1];

  const next =
    thresholds[level];

  // Maximum level reached
  if (next === undefined) {
    return {
      level,
      pct: 100,
      label: `${xp} XP · max level`
    };
  }

  const pct = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        ((xp - current) /
          (next - current)) *
          100
      )
    )
  );

  return {
    level,
    pct,
    label: `${xp} / ${next} XP`
  };
}


export async function getThresholds() {
  try {
    const snap = await getDoc(
      doc(db, "config", "levels")
    );

    if (
      snap.exists() &&
      Array.isArray(
        snap.data().thresholds
      )
    ) {
      return snap.data().thresholds;
    }

  } catch (error) {
    // Use default levels if config
    // cannot be loaded.
  }

  return DEFAULT_LEVELS;
}


// =========================================================
// UI HELPERS
// =========================================================

export function toast(
  message,
  type = "info"
) {
  let box =
    document.getElementById("toasts");

  if (!box) {
    box = document.createElement("div");

    box.id = "toasts";

    document.body.appendChild(box);
  }

  const el =
    document.createElement("div");

  el.className =
    `toast toast-${type}`;

  el.textContent = message;

  box.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 4500);
}


export function showError(
  error,
  fallback = "Something went wrong."
) {
  console.error(error);

  const code =
    error?.code || "";

  if (
    code.includes("permission-denied")
  ) {
    toast(
      "Permission denied. Check that firestore.rules is deployed.",
      "error"
    );

  } else {
    toast(
      error?.message || fallback,
      "error"
    );
  }
}


export function setBusy(
  button,
  busy,
  busyText = "Please wait..."
) {
  if (!button) return;

  if (busy) {

    button.dataset.label =
      button.textContent;

    button.textContent =
      busyText;

    button.disabled = true;

  } else {

    button.textContent =
      button.dataset.label ||
      button.textContent;

    button.disabled = false;
  }
}


// =========================================================
// CLOUD FUNCTIONS HELPER
// =========================================================

export async function callFn(
  name,
  data
) {
  try {

    const result =
      await httpsCallable(
        functions,
        name
      )(data);

    return result.data;

  } catch (error) {

    const message =
      error?.code === "functions/not-found" ||
      error?.code === "functions/internal"

        ? "Cloud Functions are not deployed yet. See README step 7."

        : error?.message ||
          "Something went wrong.";

    throw new Error(message);
  }
}


// =========================================================
// DAILY LOGIN XP
// =========================================================
//
// +10 XP once per calendar day.
//
// IMPORTANT:
//
// We NO LONGER create a dailyXpEvents document.
//
// Instead, we store the date of the last daily-login
// reward directly inside the user's profile:
//
// users/{uid}
//      xp
//      dailyLoginDate
//
// This avoids the Firestore transaction permission problem
// caused by creating dailyXpEvents.
//
// =========================================================

function getDailyLoginDate() {

  const now = new Date();

  return (
    now.getFullYear() +
    "-" +
    String(
      now.getMonth() + 1
    ).padStart(2, "0") +
    "-" +
    String(
      now.getDate()
    ).padStart(2, "0")
  );
}


export async function awardDailyLoginXp(
  uid
) {

  if (!uid) {

    return {
      awarded: false,
      xp: 0,
      message: "No logged-in user."
    };
  }

  const userRef =
    doc(db, "users", uid);

  const today =
    getDailyLoginDate();

  try {

    let awarded = false;

    await runTransaction(
      db,
      async (transaction) => {

        // ---------------------------------------------
        // Get user profile
        // ---------------------------------------------

        const userSnap =
          await transaction.get(
            userRef
          );

        if (!userSnap.exists()) {

          throw new Error(
            "User profile not found."
          );
        }

        const userData =
          userSnap.data();

        const currentXp =
          Number(userData.xp || 0);

        const lastLogin =
          userData.dailyLoginDate ||
          null;


        // ---------------------------------------------
        // Already received today's XP
        // ---------------------------------------------

        if (lastLogin === today) {

          return;
        }


        // ---------------------------------------------
        // Award +10 XP
        // ---------------------------------------------

        transaction.update(
          userRef,
          {
            xp: currentXp + 10,

            dailyLoginDate:
              today,

            updatedAt:
              serverTimestamp()
          }
        );

        awarded = true;
      }
    );


    // ---------------------------------------------
    // Result
    // ---------------------------------------------

    if (!awarded) {

      return {
        awarded: false,
        xp: 0,
        message:
          "Daily login XP already claimed today."
      };
    }


    return {
      awarded: true,
      xp: 10,
      message:
        "You earned +10 XP for today's login!"
    };


  } catch (error) {

    console.error(
      "Daily login XP error:",
      error
    );

    // Daily XP failing should NEVER
    // break the rest of the website.

    return {
      awarded: false,
      xp: 0,
      error: true,
      message:
        "Daily login XP could not be awarded."
    };
  }
}


// =========================================================
// LOGIN GUARD + NAVIGATION
// =========================================================

export function requireUser({
  needProfile = true
} = {}) {

  return new Promise(
    (resolve) => {

      const stop =
        onAuthStateChanged(
          auth,
          async (user) => {

            stop();


            // -------------------------------------------
            // User is not logged in
            // -------------------------------------------

            if (!user) {

              location.href =
                "login.html";

              return;
            }


            let profile = null;


            // -------------------------------------------
            // Load user profile
            // -------------------------------------------

            try {

              const snap =
                await getDoc(
                  doc(
                    db,
                    "users",
                    user.uid
                  )
                );

              profile =
                snap.exists()
                  ? snap.data()
                  : null;

            } catch (error) {

              showError(error);
            }


            // -------------------------------------------
            // Profile setup required
            // -------------------------------------------

            if (
              needProfile &&
              !(
                profile &&
                profile.profileComplete
              )
            ) {

              location.href =
                "profile-setup.html";

              return;
            }


            // -------------------------------------------
            // Render navigation
            // -------------------------------------------

            renderNav(
              user,
              profile
            );


            // -------------------------------------------
            // DAILY LOGIN XP
            // -------------------------------------------
            //
            // We don't wait for XP before opening
            // the page.
            //
            // If XP fails, the website continues
            // working normally.
            // -------------------------------------------

            if (
              profile &&
              profile.profileComplete
            ) {

              awardDailyLoginXp(
                user.uid
              )
                .then((result) => {

                  if (
                    result?.awarded
                  ) {

                    toast(
                      "🔥 +10 XP for today's login!",
                      "success"
                    );
                  }

                })
                .catch((error) => {

                  console.error(
                    "Daily login processing failed:",
                    error
                  );
                });
            }


            // -------------------------------------------
            // Return user + profile
            // -------------------------------------------

            resolve({
              user,
              profile
            });
          }
        );
    }
  );
}


// =========================================================
// NAVIGATION
// =========================================================

function renderNav(
  user,
  profile
) {

  const nav =
    document.getElementById(
      "siteNav"
    );

  if (!nav) return;


  const page =
    location.pathname
      .split("/")
      .pop() ||
    "index.html";


  const links = [

    [
      "dashboard.html",
      "Dashboard"
    ],

    [
      "explore.html",
      "Explore"
    ],

    [
      "connections.html",
      "Connections"
    ],

    [
      "sessions.html",
      "Sessions"
    ],

    [
      "chat.html",
      "Chat"
    ],

    [
      "profile-setup.html",
      "My profile"
    ]

  ];


  nav.innerHTML = `

    <div class="container nav-inner">

      <a
        class="brand"
        href="dashboard.html"
      >
        Skill<span>Share</span> 2.0
      </a>


      <button
        class="nav-toggle"
        id="navToggle"
        aria-label="Open menu"
        aria-expanded="false"
      >
        Menu
      </button>


      <nav
        class="nav-links"
        id="navLinks"
      >

        ${links.map(
          ([href, label]) => `

            <a
              href="${href}"
              class="${
                page === href
                  ? "active"
                  : ""
              }"
            >
              ${label}
            </a>

          `
        ).join("")}


        <button
          class="btn btn-ghost btn-sm"
          id="logoutBtn"
          type="button"
        >
          Log out
        </button>

      </nav>

    </div>

  `;


  // =====================================================
  // MOBILE MENU
  // =====================================================

  const navToggle =
    document.getElementById(
      "navToggle"
    );

  const navLinks =
    document.getElementById(
      "navLinks"
    );


  if (
    navToggle &&
    navLinks
  ) {

    navToggle.addEventListener(
      "click",
      (event) => {

        const open =
          navLinks.classList.toggle(
            "open"
          );

        event.currentTarget
          .setAttribute(
            "aria-expanded",
            String(open)
          );
      }
    );
  }


  // =====================================================
  // LOGOUT
  // =====================================================

  const logoutBtn =
    document.getElementById(
      "logoutBtn"
    );


  if (logoutBtn) {

    logoutBtn.addEventListener(
      "click",
      async () => {

        try {

          await signOut(auth);

          location.href =
            "index.html";

        } catch (error) {

          showError(
            error,
            "Could not log out."
          );
        }
      }
    );
  }


  // =====================================================
  // FIREBASE CONFIG WARNING
  // =====================================================

  if (!isConfigured) {

    const banner =
      document.createElement(
        "div"
      );

    banner.className =
      "config-banner";

    banner.textContent =
      "Firebase is not configured yet. Open js/firebase-config.js and paste your project settings.";

    document.body.prepend(
      banner
    );
  }
}


// =========================================================
// FIREBASE CONFIG WARNING
// =========================================================

export function configWarning() {

  if (!isConfigured) {

    const banner =
      document.createElement(
        "div"
      );

    banner.className =
      "config-banner";

    banner.textContent =
      "Firebase is not configured yet. Open js/firebase-config.js and paste your project settings.";

    document.body.prepend(
      banner
    );
  }
}
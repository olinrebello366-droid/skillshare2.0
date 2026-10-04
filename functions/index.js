"use strict";
/**
 * SkillShare 2.0 - Cloud Functions
 *
 * These functions are the ONLY place where XP is given out. The browser can ask
 * ("I confirm this session"), but the server decides whether XP is awarded.
 *
 * Functions:
 *   confirmSession  - a participant confirms; when both confirmed, rewards are issued
 *   disputeSession  - a participant reports a problem; session becomes "disputed"
 *   submitReview    - feedback after a completed session (+5 XP, once per person)
 *   seedSkills      - one-time copy of the default skill list into Firestore
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { CATEGORIES, slug } = require("./skills-data");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Region must match FUNCTIONS_REGION in js/firebase-config.js
setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

// ---------------------------------------------------------------------------
// Settings you can change
// ---------------------------------------------------------------------------
const CONFIG = {
  // Set to true ONLY while testing: skips the "session must have started" check.
  TESTING_MODE: false,
  MIN_CONFIRM_MINUTES: 10,      // people can confirm this long after the start time
  XP_TEACH: 30,
  XP_LEARN: 20,
  XP_FEEDBACK: 5,
  DAILY_XP_CAP: 100,            // max XP a user can earn per day (UTC day)
  PAIR_MAX_REWARDED: 3,         // max rewarded sessions between the same two people...
  PAIR_WINDOW_DAYS: 7,          // ...inside this many days
  DEFAULT_LEVELS: [0, 100, 300, 600, 1000], // used if config/levels does not exist
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function requireAuth(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in first.");
  return req.auth.uid;
}

function levelFromXp(xp, thresholds) {
  let level = 1;
  thresholds.forEach((t, i) => { if (xp >= t) level = i + 1; });
  return level;
}

function thresholdsFrom(snap) {
  if (snap.exists && Array.isArray(snap.data().thresholds)) return snap.data().thresholds;
  return CONFIG.DEFAULT_LEVELS;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function str(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// confirmSession
// ---------------------------------------------------------------------------
exports.confirmSession = onCall(async (req) => {
  const uid = requireAuth(req);
  const sessionId = str(req.data && req.data.sessionId, 128);
  if (!sessionId) throw new HttpsError("invalid-argument", "Missing session id.");

  const sRef = db.collection("sessions").doc(sessionId);

  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists) throw new HttpsError("not-found", "Session not found.");
    const s = sSnap.data();

    if (!Array.isArray(s.participants) || !s.participants.includes(uid)) {
      throw new HttpsError("permission-denied", "You are not part of this session.");
    }
    if (!["scheduled", "pending_confirmation"].includes(s.status)) {
      throw new HttpsError("failed-precondition", `This session is already ${s.status}.`);
    }
    if ((s.confirmedBy || []).includes(uid)) {
      throw new HttpsError("already-exists", "You have already confirmed this session.");
    }
    if (!CONFIG.TESTING_MODE) {
      const earliest = s.startAt.toMillis() + CONFIG.MIN_CONFIRM_MINUTES * 60000;
      if (Date.now() < earliest) {
        throw new HttpsError(
          "failed-precondition",
          `You can confirm once the session has run for at least ${CONFIG.MIN_CONFIRM_MINUTES} minutes.`
        );
      }
    }

    const confirmedBy = [...(s.confirmedBy || []), uid];

    // ----- Only one person has confirmed so far: keep waiting -----
    if (confirmedBy.length < 2) {
      tx.update(sRef, {
        confirmedBy,
        status: "pending_confirmation",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: "pending_confirmation", message: "Confirmed. Waiting for the other person to confirm." };
    }

    // ----- Both confirmed: complete the session and issue rewards -----
    const now = Date.now();
    const day = dayKey();
    const T = s.teacherId;
    const L = s.learnerId;

    // All reads first (Firestore transactions require reads before writes)
    const refs = {
      teacher: db.doc(`users/${T}`),
      levels: db.doc("config/levels"),
      pair: db.doc(`pairs/${s.pairKey}`),
      rewT: db.doc(`rewards/${sessionId}_${T}`),
      rewL: db.doc(`rewards/${sessionId}_${L}`),
      dayT: db.doc(`dailyXp/${T}_${day}`),
      dayL: db.doc(`dailyXp/${L}_${day}`),
      statT: db.doc(`users/${T}/skillStats/${s.skillId}`),
      statL: db.doc(`users/${L}/skillStats/${s.skillId}`),
    };
    const keys = Object.keys(refs);
    const snaps = await tx.getAll(...keys.map((k) => refs[k]));
    const S = {};
    keys.forEach((k, i) => { S[k] = snaps[i]; });

    const thresholds = thresholdsFrom(S.levels);
    const windowMs = CONFIG.PAIR_WINDOW_DAYS * 86400000;
    const recent = ((S.pair.exists && S.pair.data().recent) || []).filter((ms) => ms > now - windowMs);

    // Safeguards: valid skill, and not too many rewarded sessions for the same pair
    let blocked = "";
    const teacherData = S.teacher.exists ? S.teacher.data() : null;
    if (!teacherData || !(teacherData.teachIds || []).includes(s.skillId)) {
      blocked = "No XP given: this skill is not on the teacher's profile.";
    } else if (recent.length >= CONFIG.PAIR_MAX_REWARDED) {
      blocked = `No XP given: these two people already earned XP together ${CONFIG.PAIR_MAX_REWARDED} times in the last ${CONFIG.PAIR_WINDOW_DAYS} days.`;
    }

    const sides = [
      { uid: T, type: "teaching", base: CONFIG.XP_TEACH, rew: S.rewT, day: S.dayT, stat: S.statT },
      { uid: L, type: "learning", base: CONFIG.XP_LEARN, rew: S.rewL, day: S.dayL, stat: S.statL },
    ];

    const xpAwarded = {};
    const notes = [];
    let totalXp = 0;

    for (const side of sides) {
      const used = side.day.exists ? side.day.data().xp || 0 : 0;
      let xp = 0;
      // A reward document with this id means this user was already rewarded for this session.
      if (!blocked && !side.rew.exists) {
        xp = Math.max(0, Math.min(side.base, CONFIG.DAILY_XP_CAP - used));
        if (xp < side.base) notes.push("Daily XP limit reached, so some XP was not given.");
      }
      xpAwarded[side.uid] = xp;
      totalXp += xp;

      const oldXp = side.stat.exists ? side.stat.data().xp || 0 : 0;
      const newXp = oldXp + xp;
      tx.set(side.stat.ref, {
        skillId: s.skillId,
        skillName: s.skillName,
        xp: newXp,
        level: levelFromXp(newXp, thresholds),
        earned: newXp > 0,
        sessions: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (xp > 0) {
        tx.set(side.rew.ref, {
          uid: side.uid,
          sessionId,
          skillId: s.skillId,
          skillName: s.skillName,
          xp,
          type: side.type,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(side.day.ref, { uid: side.uid, day, xp: used + xp }, { merge: true });
      }
    }

    if (totalXp > 0) {
      tx.set(refs.pair, { pairKey: s.pairKey, recent: [...recent, now] });
    }

    const note = blocked || [...new Set(notes)].join(" ");
    tx.update(sRef, {
      confirmedBy,
      status: "completed",
      rewarded: true,
      xpAwarded,
      rewardNote: note,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      status: "completed",
      xp: xpAwarded[uid] || 0,
      message: xpAwarded[uid] > 0
        ? `Session completed! You earned +${xpAwarded[uid]} XP in ${s.skillName}.`
        : `Session completed. ${note || "No XP was given this time."}`,
    };
  });
});

// ---------------------------------------------------------------------------
// disputeSession
// ---------------------------------------------------------------------------
exports.disputeSession = onCall(async (req) => {
  const uid = requireAuth(req);
  const sessionId = str(req.data && req.data.sessionId, 128);
  const reason = str(req.data && req.data.reason, 300);
  if (!sessionId) throw new HttpsError("invalid-argument", "Missing session id.");
  if (reason.length < 5) throw new HttpsError("invalid-argument", "Please describe the problem (at least 5 characters).");

  const sRef = db.collection("sessions").doc(sessionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sRef);
    if (!snap.exists) throw new HttpsError("not-found", "Session not found.");
    const s = snap.data();
    if (!s.participants.includes(uid)) throw new HttpsError("permission-denied", "You are not part of this session.");
    if (!["scheduled", "pending_confirmation"].includes(s.status)) {
      throw new HttpsError("failed-precondition", `This session is already ${s.status}.`);
    }
    tx.update(sRef, { status: "disputed", updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection("reports").doc(), {
      sessionId,
      reportedBy: uid,
      reason,
      participants: s.participants,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { status: "disputed", message: "Reported. This session is now marked as disputed and gives no XP." };
});

// ---------------------------------------------------------------------------
// submitReview  (+5 XP, once per person per completed session)
// ---------------------------------------------------------------------------
exports.submitReview = onCall(async (req) => {
  const uid = requireAuth(req);
  const sessionId = str(req.data && req.data.sessionId, 128);
  const rating = Number(req.data && req.data.rating);
  const comment = str(req.data && req.data.comment, 300);
  if (!sessionId) throw new HttpsError("invalid-argument", "Missing session id.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "Rating must be a whole number from 1 to 5.");
  }

  const sRef = db.collection("sessions").doc(sessionId);
  const day = dayKey();

  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists) throw new HttpsError("not-found", "Session not found.");
    const s = sSnap.data();
    if (!s.participants.includes(uid)) throw new HttpsError("permission-denied", "You are not part of this session.");
    if (s.status !== "completed") throw new HttpsError("failed-precondition", "You can review a session only after it is completed.");

    const refs = {
      review: db.doc(`reviews/${sessionId}_${uid}`),
      rew: db.doc(`rewards/${sessionId}_${uid}_feedback`),
      day: db.doc(`dailyXp/${uid}_${day}`),
      stat: db.doc(`users/${uid}/skillStats/${s.skillId}`),
      levels: db.doc("config/levels"),
    };
    const keys = Object.keys(refs);
    const snaps = await tx.getAll(...keys.map((k) => refs[k]));
    const S = {};
    keys.forEach((k, i) => { S[k] = snaps[i]; });

    if (S.review.exists || (s.reviewedBy || []).includes(uid)) {
      throw new HttpsError("already-exists", "You have already reviewed this session.");
    }

    const used = S.day.exists ? S.day.data().xp || 0 : 0;
    const xp = S.rew.exists ? 0 : Math.max(0, Math.min(CONFIG.XP_FEEDBACK, CONFIG.DAILY_XP_CAP - used));
    const other = s.participants.find((p) => p !== uid);

    tx.set(refs.review, {
      sessionId,
      reviewerId: uid,
      revieweeId: other,
      skillId: s.skillId,
      rating,
      comment,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(sRef, { reviewedBy: FieldValue.arrayUnion(uid) });

    if (xp > 0) {
      const thresholds = thresholdsFrom(S.levels);
      const oldXp = S.stat.exists ? S.stat.data().xp || 0 : 0;
      const newXp = oldXp + xp;
      tx.set(refs.stat, {
        skillId: s.skillId,
        skillName: s.skillName,
        xp: newXp,
        level: levelFromXp(newXp, thresholds),
        earned: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(refs.rew, {
        uid,
        sessionId,
        skillId: s.skillId,
        skillName: s.skillName,
        xp,
        type: "feedback",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(refs.day, { uid, day, xp: used + xp }, { merge: true });
    }

    return {
      xp,
      message: xp > 0 ? `Thanks for your feedback! +${xp} XP in ${s.skillName}.` : "Thanks for your feedback! (Daily XP limit reached, so no XP this time.)",
    };
  });
});

// ---------------------------------------------------------------------------
// seedSkills  (safe to call many times: does nothing if skills already exist)
// ---------------------------------------------------------------------------
exports.seedSkills = onCall(async (req) => {
  requireAuth(req);
  const existing = await db.collection("skills").limit(1).get();
  if (!existing.empty) return { seeded: 0 };

  const batch = db.batch();
  let count = 0;
  for (const [category, names] of Object.entries(CATEGORIES)) {
    for (const name of names) {
      batch.set(db.doc(`skills/${slug(name)}`), { name, category });
      count++;
    }
  }
  batch.set(db.doc("config/levels"), { thresholds: CONFIG.DEFAULT_LEVELS }, { merge: true });
  await batch.commit();
  return { seeded: count };
});

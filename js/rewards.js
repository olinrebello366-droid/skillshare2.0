
import { db } from "./firebase-config.js";

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


// ---------- XP RULES ----------

export const XP_RULES = {
  teach: 30,
  learn: 20,
  feedback: 5,
  dailyLogin: 10
};


// ---------- SESSION COMPLETION ----------

export async function confirmSession(sessionId, uid) {

  const sessionRef =
    doc(db, "sessions", sessionId);

  return await runTransaction(
    db,
    async (transaction) => {

      const snap =
        await transaction.get(sessionRef);

      if (!snap.exists()) {
        throw new Error("Session not found.");
      }

      const session =
        snap.data();

      const confirmedBy =
        Array.isArray(session.confirmedBy)
          ? session.confirmedBy
          : [];

      if (
        !Array.isArray(session.participants) ||
        !session.participants.includes(uid)
      ) {
        throw new Error(
          "You are not part of this session."
        );
      }

      if (confirmedBy.includes(uid)) {
        throw new Error(
          "You have already confirmed this session."
        );
      }

      if (
        ![
          "scheduled",
          "pending_confirmation"
        ].includes(session.status)
      ) {
        throw new Error(
          "This session cannot be confirmed."
        );
      }

      const startAt =
        session.startAt?.toDate
          ? session.startAt.toDate()
          : new Date(session.startAt);

      if (
        !startAt ||
        isNaN(startAt.getTime()) ||
        startAt > new Date()
      ) {
        throw new Error(
          "You can only confirm a session after its scheduled start time."
        );
      }

      const nextConfirmed =
        [...confirmedBy, uid];

      const completed =
        nextConfirmed.length === 2;

      transaction.update(
        sessionRef,
        {
          confirmedBy: nextConfirmed,
          status: completed
            ? "completed"
            : "pending_confirmation",
          updatedAt: serverTimestamp()
        }
      );

      return {
        status: completed
          ? "completed"
          : "pending_confirmation",

        message: completed
          ? "Both participants confirmed! Session completed."
          : "Your confirmation was saved. Waiting for your partner."
      };
    }
  );
}


// ---------- LOAD REWARD HISTORY ----------

export async function loadRewards(
  uid,
  count = 10
) {

  try {

    const q =
      query(
        collection(db, "rewards"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(count)
      );

    const snap =
      await getDocs(q);

    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

  } catch (error) {

    console.warn(
      "Reward history is not available yet.",
      error
    );

    return [];
  }
}


// ---------- DISPUTE ----------

export async function disputeSession(
  sessionId,
  reason
) {

  throw new Error(
    "Problem reporting is not available in the free-plan version yet."
  );
}
// ---------- AWARD SESSION XP ----------
//
// Each participant claims their own XP.
// The event ID is unique to:
// session + user
//
// Teacher = +30 XP
// Learner = +20 XP
//
// The Firestore rules will make sure the event is valid
// and the same event cannot be created twice.

export async function awardSessionXp(sessionId, uid) {

  const sessionRef =
    doc(db, "sessions", sessionId);

  const userRef =
    doc(db, "users", uid);

  const eventId =
    `${sessionId}_${uid}`;

  const eventRef =
    doc(db, "xpEvents", eventId);

  return await runTransaction(
    db,
    async (transaction) => {

      const sessionSnap =
        await transaction.get(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error("Session not found.");
      }

      const session =
        sessionSnap.data();

      if (session.status !== "completed") {
        throw new Error(
          "This session is not completed yet."
        );
      }

      if (
        !Array.isArray(session.participants) ||
        !session.participants.includes(uid)
      ) {
        throw new Error(
          "You are not part of this session."
        );
      }

      if (
        !Array.isArray(session.confirmedBy) ||
        session.confirmedBy.length !== 2
      ) {
        throw new Error(
          "Both participants must confirm the session first."
        );
      }

      // Check whether this user has already received
      // XP for this session.
      const existingEvent =
        await transaction.get(eventRef);

      if (existingEvent.exists()) {
        return {
          awarded: false,
          xp: existingEvent.data().xp || 0,
          message: "XP has already been awarded for this session."
        };
      }

      const userSnap =
        await transaction.get(userRef);

      if (!userSnap.exists()) {
        throw new Error("User profile not found.");
      }

      const userData =
        userSnap.data();

      const currentXp =
        Number(userData.xp) || 0;

      let xp = 0;
      let type = "";

      if (uid === session.teacherId) {

        xp = XP_RULES.teach;
        type = "teaching";

      } else if (uid === session.learnerId) {

        xp = XP_RULES.learn;
        type = "learning";

      } else {

        throw new Error(
          "Could not determine your role in this session."
        );
      }

      transaction.set(eventRef, {
        uid,
        sessionId,
        type,
        xp,
        createdAt: serverTimestamp()
      });

      transaction.update(userRef, {
        xp: currentXp + xp,
        lastXpEventId: eventId,
        updatedAt: serverTimestamp()
      });

      return {
        awarded: true,
        xp,
        type,
        message:
          `You earned +${xp} XP for this completed session.`
      };
    }
  );
}
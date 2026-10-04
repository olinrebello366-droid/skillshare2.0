// Everything related to sessions + XP that talks to Cloud Functions.
// The browser never writes XP itself: it only asks the server to do it.
import { db } from "./firebase-config.js";
import { callFn } from "./common.js";
import {
  collection, getDocs, query, where, orderBy, limit,
  doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Display only. The real numbers are in functions/index.js (CONFIG).
export const XP_RULES = { teach: 30, learn: 20, feedback: 5 };

export const disputeSession = (sessionId, reason) => callFn("disputeSession", { sessionId, reason   });
export async function confirmSession(sessionId, uid) {
  const sessionRef = doc(db, "sessions", sessionId);

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(sessionRef);

    if (!snap.exists()) {
      throw new Error("Session not found.");
    }

    const session = snap.data();
    const confirmedBy = session.confirmedBy || [];

    if (!session.participants.includes(uid)) {
      throw new Error("You are not part of this session.");
    }

    if (confirmedBy.includes(uid)) {
      throw new Error("You have already confirmed this session.");
    }

    if (!["scheduled", "pending_confirmation"].includes(session.status)) {
      throw new Error("This session cannot be confirmed.");
    }

    const nextConfirmed = [...confirmedBy, uid];
    const completed = nextConfirmed.length === 2;

    transaction.update(sessionRef, {
      confirmedBy: nextConfirmed,
      status: completed ? "completed" : "pending_confirmation",
      updatedAt: serverTimestamp()
    });

    return {
      status: completed ? "completed" : "pending_confirmation",
      message: completed
        ? "Both participants confirmed! Session completed."
        : "Your confirmation was saved. Waiting for your partner."
    };
  });
}

// Reward history for one user (needs the composite index in firestore.indexes.json).
export async function loadRewards(uid, count = 10) {
  const q = query(collection(db, "rewards"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

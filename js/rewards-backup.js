// Everything related to sessions + XP that talks to Cloud Functions.
// The browser never writes XP itself: it only asks the server to do it.
import { db } from "./firebase-config.js";
import { callFn } from "./common.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Display only. The real numbers are in functions/index.js (CONFIG).
export const XP_RULES = { teach: 30, learn: 20, feedback: 5 };

export const confirmSession = (sessionId) => callFn("confirmSession", { sessionId });
export const disputeSession = (sessionId, reason) => callFn("disputeSession", { sessionId, reason });
export const submitReview = (sessionId, rating, comment) => callFn("submitReview", { sessionId, rating, comment });

// Reward history for one user (needs the composite index in firestore.indexes.json).
export async function loadRewards(uid, count = 10) {
  const q = query(collection(db, "rewards"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

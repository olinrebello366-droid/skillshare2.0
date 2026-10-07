// Connections: incoming requests, sent requests and accepted connections (live updates).
import { db, auth } from "./firebase-config.js";
import {
  collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser, esc, avatar, toast, showError } from "./common.js";

const { user } = await requireUser();
const incomingEl = document.getElementById("incoming");
const sentEl = document.getElementById("sent");
const connectedEl = document.getElementById("connected");

const otherId = (c) => c.participants.find((p) => p !== user.uid);
const otherName = (c) => c.names?.[otherId(c)] || "Unknown";

const row = (c, actions) => `
  <div class="person-row">
    ${avatar(otherName(c))}
    <div class="grow"><strong>${esc(otherName(c))}</strong></div>
    <div class="row-actions">${actions}</div>
  </div>`;

onSnapshot(
  query(collection(db, "connections"), where("participants", "array-contains", user.uid)),
  (snap) => {
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const incoming = all.filter((c) => c.status === "pending" && c.receiverId === user.uid);
    const sent = all.filter((c) => c.status === "pending" && c.requesterId === user.uid);
    const connected = all.filter((c) => c.status === "accepted");

    document.getElementById("incomingCount").textContent = incoming.length;
    document.getElementById("sentCount").textContent = sent.length;
    document.getElementById("connectedCount").textContent = connected.length;

    incomingEl.innerHTML = incoming.length
      ? incoming.map((c) => row(c, `
          <button class="btn btn-primary btn-sm" data-act="accept" data-id="${esc(c.id)}">Accept</button>
          <button class="btn btn-ghost btn-sm" data-act="remove" data-id="${esc(c.id)}">Reject</button>`)).join("")
      : `<p class="empty">No requests waiting for you.</p>`;

    sentEl.innerHTML = sent.length
      ? sent.map((c) => row(c, `<button class="btn btn-ghost btn-sm" data-act="remove" data-id="${esc(c.id)}">Cancel request</button>`)).join("")
      : `<p class="empty">You have not sent any requests. <a href="explore.html">Find people</a>.</p>`;

    connectedEl.innerHTML = connected.length
      ? connected.map((c) => row(c, `
          <a class="btn btn-ghost btn-sm" href="chat.html?c=${esc(c.id)}">Chat</a>
          <a class="btn btn-primary btn-sm" href="sessions.html?with=${esc(otherId(c))}">Schedule session</a>`)).join("")
      : `<p class="empty">No connections yet. Accept a request or <a href="explore.html">find someone to connect with</a>.</p>`;
  },
  (err) => showError(err, "Could not load connections.")
);

document.querySelector("main").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  btn.disabled = true;
  try {
    if (btn.dataset.act === "accept") {
      console.log("ACCEPT DEBUG:", {
  connectionId: btn.dataset.id,
  currentUser: auth.currentUser?.uid
});
    await updateDoc(doc(db, "connections", btn.dataset.id), {
  status: "accepted",
  updatedAt: serverTimestamp()
});
      toast("Connection accepted. You can now chat and schedule sessions.", "success");
    } else if (btn.dataset.act === "remove") {
      await deleteDoc(doc(db, "connections", btn.dataset.id));
    }
  } catch (err) {
    showError(err);
    btn.disabled = false;
  }
});

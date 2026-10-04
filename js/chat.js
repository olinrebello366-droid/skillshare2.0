// Real-time chat between accepted connections.
import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser, esc, avatar, tsToDate, fmtDateTime, showError } from "./common.js";

const { user, profile } = await requireUser();

const layout = document.getElementById("chatLayout");
const listEl = document.getElementById("convList");
const msgsEl = document.getElementById("messages");
const titleEl = document.getElementById("threadTitle");
const form = document.getElementById("msgForm");
const input = document.getElementById("msgInput");

let conns = [];
let activeId = null;
let unsubscribeMessages = null;
const wanted = new URLSearchParams(location.search).get("c");

const otherName = (c) => c.names?.[c.participants.find((p) => p !== user.uid)] || "Unknown";

function renderList() {
  if (conns.length === 0) {
    listEl.innerHTML = `<p class="empty">No conversations yet. <a href="explore.html">Connect with someone</a> and have them accept.</p>`;
    return;
  }
  listEl.innerHTML = conns.map((c) => `
    <button class="conv ${c.id === activeId ? "active" : ""}" data-id="${esc(c.id)}">
      ${avatar(otherName(c))}<strong>${esc(otherName(c))}</strong>
    </button>`).join("");
}

function openConversation(id) {
  const conn = conns.find((c) => c.id === id);
  if (!conn) return;
  activeId = id;
  layout.classList.add("show-thread");
  titleEl.textContent = otherName(conn);
  form.hidden = false;
  history.replaceState(null, "", `chat.html?c=${encodeURIComponent(id)}`);
  renderList();

  if (unsubscribeMessages) unsubscribeMessages();
  msgsEl.innerHTML = "";
  unsubscribeMessages = onSnapshot(
    query(collection(db, "connections", id, "messages"), orderBy("createdAt", "asc"), limit(200)),
    (snap) => {
      if (snap.empty) {
        msgsEl.innerHTML = `<p class="empty">Say hello to ${esc(otherName(conn))}.</p>`;
        return;
      }
      msgsEl.innerHTML = snap.docs.map((d) => {
        const m = d.data();
        const mine = m.senderId === user.uid;
        const when = tsToDate(m.createdAt);
        return `<div class="msg ${mine ? "mine" : ""}">
          <div class="msg-meta">${esc(mine ? "You" : m.senderName)} · ${when ? esc(fmtDateTime(when)) : "sending..."}</div>
          <div class="msg-text">${esc(m.text)}</div>
        </div>`;
      }).join("");
      msgsEl.scrollTop = msgsEl.scrollHeight;
    },
    (err) => showError(err, "Could not load messages.")
  );
}

onSnapshot(
  query(collection(db, "connections"), where("participants", "array-contains", user.uid)),
  (snap) => {
    conns = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.status === "accepted");
    renderList();
    if (!activeId) {
      if (wanted && conns.some((c) => c.id === wanted)) openConversation(wanted);
      else if (conns.length && window.innerWidth > 760) openConversation(conns[0].id);
    }
  },
  (err) => showError(err, "Could not load conversations.")
);

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".conv");
  if (btn) openConversation(btn.dataset.id);
});

document.getElementById("backBtn").addEventListener("click", () => layout.classList.remove("show-thread"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !activeId) return;
  input.value = "";
  try {
    await addDoc(collection(db, "connections", activeId, "messages"), {
      senderId: user.uid,
      senderName: profile.name,
      text,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    input.value = text;
    showError(err, "Message could not be sent.");
  }
});

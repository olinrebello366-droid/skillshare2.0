// Explore: find people by skill, view profiles, send connection requests.
import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, where, limit, doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser, esc, avatar, pairKey, getThresholds, levelFromXp, toast, showError } from "./common.js";
import { loadSkills } from "./skills.js";

const { user, profile } = await requireUser();
const thresholds = await getThresholds();
const skills = await loadSkills();

const grid = document.getElementById("results");
const search = document.getElementById("searchInput");
const filter = document.getElementById("skillFilter");
const dialog = document.getElementById("profileDialog");

filter.innerHTML = `<option value="">All skills</option>` +
  skills.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");

let people = [];                    // [{ uid, ...profile }]
const statsCache = new Map();       // uid -> { skillId: {xp, sessions} }
const connections = new Map();      // other uid -> { status, requesterId }

try {
  const [usersSnap, connSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("profileComplete", "==", true), limit(100))),
    getDocs(query(collection(db, "connections"), where("participants", "array-contains", user.uid))),
  ]);
  people = usersSnap.docs.filter((d) => d.id !== user.uid).map((d) => ({ uid: d.id, ...d.data() }));
  connSnap.forEach((d) => {
    const c = d.data();
    const other = c.participants.find((p) => p !== user.uid);
    connections.set(other, { status: c.status, requesterId: c.requesterId, id: d.id });
  });
} catch (e) {
  showError(e, "Could not load people.");
}

function visiblePeople() {
  const q = search.value.trim().toLowerCase();
  const skillId = filter.value;
  return people.filter((p) => {
    if (skillId && !(p.teachIds || []).includes(skillId)) return false;
    if (!q) return true;
    const haystack = [p.name, p.bio, ...(p.teach || []).map((t) => t.name), ...(p.learn || []).map((l) => l.name)]
      .join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function skillTag(person, t) {
  const stat = statsCache.get(person.uid)?.[t.skillId];
  if (stat && stat.xp > 0) return `<span class="chip chip-static" title="Level earned through sessions">${esc(t.name)} · Level ${levelFromXp(stat.xp, thresholds)}</span>`;
  return `<span class="chip chip-static" title="Self-declared level">${esc(t.name)} · Level ${t.selfLevel || 1} (self)</span>`;
}

function connectButton(person) {
  const c = connections.get(person.uid);
  if (!c) return `<button class="btn btn-primary btn-sm" data-act="connect" data-uid="${esc(person.uid)}">Connect</button>`;
  if (c.status === "accepted") return `<a class="btn btn-ghost btn-sm" href="chat.html?c=${esc(c.id)}">Connected · Chat</a>`;
  if (c.requesterId === user.uid) return `<button class="btn btn-ghost btn-sm" disabled>Request sent</button>`;
  return `<a class="btn btn-primary btn-sm" href="connections.html">Respond to request</a>`;
}

function render() {
  const list = visiblePeople();
  if (list.length === 0) {
    grid.innerHTML = `<p class="empty">${people.length === 0 ? "No one else has joined yet. Invite a friend to try SkillShare." : "No one matches your search. Try a different skill."}</p>`;
    return;
  }
  grid.innerHTML = list.map((p) => `
    <article class="card user-card">
      <div class="user-head">${avatar(p.name)}<h3>${esc(p.name)}</h3></div>
      <p class="bio">${esc(p.bio || "No bio yet.")}</p>
      <div class="tags">${(p.teach || []).length ? (p.teach || []).slice(0, 4).map((t) => skillTag(p, t)).join("") : `<span class="muted small">Not teaching anything yet</span>`}</div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-act="view" data-uid="${esc(p.uid)}">View profile</button>
        ${connectButton(p)}
      </div>
    </article>`).join("");
  loadMissingStats(list.slice(0, 24));
}

async function loadMissingStats(list) {
  const missing = list.filter((p) => !statsCache.has(p.uid));
  if (missing.length === 0) return;
  await Promise.all(missing.map(async (p) => {
    try {
      const snap = await getDocs(collection(db, "users", p.uid, "skillStats"));
      const stats = {};
      snap.forEach((d) => { stats[d.id] = d.data(); });
      statsCache.set(p.uid, stats);
    } catch (e) { statsCache.set(p.uid, {}); }
  }));
  render();
}

function openProfile(person) {
  const stats = statsCache.get(person.uid) || {};
  const sessionsDone = Object.values(stats).reduce((sum, s) => sum + (s.sessions || 0), 0);
  document.getElementById("profileBody").innerHTML = `
    <div class="profile-head">${avatar(person.name, "lg")}<div><h2>${esc(person.name)}</h2>
      <p class="muted">${esc(person.bio || "No bio yet.")}</p></div></div>
    <h4>Can teach</h4>
    <div class="tags">${(person.teach || []).map((t) => skillTag(person, t)).join("") || `<span class="muted small">Nothing yet</span>`}</div>
    <h4>Wants to learn</h4>
    <div class="tags">${(person.learn || []).map((l) => `<span class="chip chip-static">${esc(l.name)}</span>`).join("") || `<span class="muted small">Nothing yet</span>`}</div>
    <p class="muted small">Sessions completed: ${sessionsDone}</p>`;
  dialog.showModal();
}

grid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const person = people.find((p) => p.uid === btn.dataset.uid);
  if (!person) return;

  if (btn.dataset.act === "view") {
    await loadMissingStats([person]);
    openProfile(person);
  }

  if (btn.dataset.act === "connect") {
    btn.disabled = true;
    try {
      const id = pairKey(user.uid, person.uid);
      await setDoc(doc(db, "connections", id), {
        participants: [user.uid, person.uid],
        requesterId: user.uid,
        receiverId: person.uid,
        names: { [user.uid]: profile.name, [person.uid]: person.name },
        status: "pending",
        createdAt: serverTimestamp(),
      });
      connections.set(person.uid, { status: "pending", requesterId: user.uid, id });
      toast(`Request sent to ${person.name}.`, "success");
      render();
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  }
});

document.getElementById("closeProfile").addEventListener("click", () => dialog.close());

let timer;
search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 200); });
filter.addEventListener("change", render);
render();

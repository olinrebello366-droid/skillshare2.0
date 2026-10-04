// Dashboard: everything shown here is read from the logged-in user's Firebase data.
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser, esc, avatar, getThresholds, levelFromXp, levelProgress, tsToDate, fmtDateTime, showError } from "./common.js";
import { loadRewards } from "./rewards.js";

const { user, profile } = await requireUser();

try {
  const thresholds = await getThresholds();
  const [statsSnap, sessionsSnap, connSnap, rewards] = await Promise.all([
    getDocs(collection(db, "users", user.uid, "skillStats")),
    getDocs(query(collection(db, "sessions"), where("participants", "array-contains", user.uid))),
    getDocs(query(collection(db, "connections"), where("participants", "array-contains", user.uid))),
    loadRewards(user.uid, 6).catch((e) => {
      console.warn("Reward history needs the Firestore index. Deploy firestore.indexes.json (README step 6).", e);
      return [];
    }),
  ]);

  const stats = {};
  statsSnap.forEach((d) => { stats[d.id] = d.data(); });
  const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const conns = connSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  renderWelcome();
  renderSummary();
  renderSkills();
  renderUpcoming();
  renderRequests();
  renderActivity();

  function renderWelcome() {
    document.getElementById("welcome").textContent = `Welcome back, ${profile.name.split(" ")[0]}`;
  }

  function renderSummary() {
    const completed = sessions.filter((s) => s.status === "completed").length;
    const connected = conns.filter((c) => c.status === "accepted").length;
    document.getElementById("summary").innerHTML = `
      <div class="profile-head">
        ${avatar(profile.name, "lg")}
        <div>
          <h2>${esc(profile.name)}</h2>
          <p class="muted">${esc(profile.bio || "Add a short bio so people know who you are.")}</p>
        </div>
      </div>
      <div class="stat-row">
        <div><strong>${(profile.teach || []).length}</strong><span>skills teaching</span></div>
        <div><strong>${(profile.learn || []).length}</strong><span>skills learning</span></div>
        <div><strong>${connected}</strong><span>connections</span></div>
        <div><strong>${completed}</strong><span>sessions completed</span></div>
      </div>
      <a class="btn btn-ghost btn-sm" href="profile-setup.html">Edit profile</a>`;
  }

  function renderSkills() {
    const wrap = document.getElementById("skillLevels");
    const byId = new Map();
    (profile.teach || []).forEach((t) => byId.set(t.skillId, { ...t, teaching: true }));
    (profile.learn || []).forEach((l) => { if (!byId.has(l.skillId)) byId.set(l.skillId, { ...l, teaching: false }); });
    if (byId.size === 0) {
      wrap.innerHTML = `<p class="empty">No skills yet. <a href="profile-setup.html">Add skills</a> to start.</p>`;
      return;
    }
    wrap.innerHTML = [...byId.values()].map((skill) => {
      const stat = stats[skill.skillId];
      const xp = stat?.xp || 0;
      const earned = xp > 0;
      const prog = levelProgress(xp, thresholds);
      const levelText = earned
        ? `Level ${levelFromXp(xp, thresholds)}`
        : skill.selfLevel ? `Level ${skill.selfLevel}` : "Level 1";
      const tag = earned ? `<span class="badge badge-ok">Earned</span>` : skill.selfLevel ? `<span class="badge">Self-declared</span>` : "";
      return `
        <div class="skill-row">
          <div class="skill-top">
            <strong>${esc(skill.name)}</strong>
            <span class="muted small">${skill.teaching ? "Teaching" : "Learning"}</span>
            <span class="level-pill">${levelText}</span>${tag}
          </div>
          <div class="bar" role="progressbar" aria-valuenow="${prog.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${prog.pct}%"></span></div>
          <div class="muted small">${earned ? esc(prog.label) : "0 XP · complete a session to earn your level"}</div>
        </div>`;
    }).join("");
  }

  function renderUpcoming() {
    const wrap = document.getElementById("upcoming");
    const list = sessions
      .filter((s) => ["scheduled", "pending_confirmation"].includes(s.status))
      .sort((a, b) => tsToDate(a.startAt) - tsToDate(b.startAt))
      .slice(0, 4);
    if (list.length === 0) {
      wrap.innerHTML = `<p class="empty">No upcoming sessions. <a href="sessions.html">Schedule one</a>.</p>`;
      return;
    }
    wrap.innerHTML = list.map((s) => {
      const iTeach = s.teacherId === user.uid;
      const partner = iTeach ? s.learnerName : s.teacherName;
      return `<a class="list-item" href="sessions.html">
        <strong>${esc(s.skillName)}</strong>
        <span class="muted small">${iTeach ? "Teaching" : "Learning from"} ${esc(partner)} · ${esc(fmtDateTime(tsToDate(s.startAt)))}</span>
      </a>`;
    }).join("");
  }

  function renderRequests() {
    const wrap = document.getElementById("requests");
    const pending = conns.filter((c) => c.status === "pending" && c.receiverId === user.uid);
    if (pending.length === 0) {
      wrap.innerHTML = `<p class="empty">No pending requests.</p>`;
      return;
    }
    wrap.innerHTML = pending.map((c) => `
      <a class="list-item" href="connections.html">
        <strong>${esc(c.names?.[c.requesterId] || "Someone")}</strong>
        <span class="muted small">wants to connect with you</span>
      </a>`).join("");
  }

  function renderActivity() {
    const items = [];
    rewards.forEach((r) => {
      const label = r.type === "feedback" ? "for feedback" : r.type === "teaching" ? "for teaching" : "for learning";
      items.push({ at: tsToDate(r.createdAt), text: `+${r.xp} XP in ${r.skillName} ${label}` });
    });
    sessions.forEach((s) => {
      const at = tsToDate(s.updatedAt) || tsToDate(s.createdAt);
      const label = { completed: "completed", cancelled: "cancelled", disputed: "reported" }[s.status];
      if (label) items.push({ at, text: `Session "${s.skillName}" ${label}` });
    });
    const wrap = document.getElementById("activity");
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    if (items.length === 0) {
      wrap.innerHTML = `<p class="empty">Nothing yet. Your sessions and XP will show up here.</p>`;
      return;
    }
    wrap.innerHTML = items.slice(0, 6).map((i) => `
      <div class="list-item"><span>${esc(i.text)}</span><span class="muted small">${esc(fmtDateTime(i.at))}</span></div>`).join("");
  }
} catch (e) {
  showError(e, "Could not load your dashboard.");
}

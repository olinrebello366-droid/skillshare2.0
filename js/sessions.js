
// SkillShare 2.0 — Sessions
import { db } from "./firebase-config.js";

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  requireUser,
  esc,
  tsToDate,
  fmtDateTime,
  toast,
  showError,
  setBusy
} from "./common.js";

import {
  confirmSession,
  disputeSession
} from "./rewards.js";

const { user, profile } = await requireUser();

const $ = (id) => document.getElementById(id);

const withSel = $("withSelect");
const roleSel = $("roleSelect");
const skillSel = $("skillSelect");
const dateIn = $("dateInput");
const timeIn = $("timeInput");
const durSel = $("durationSelect");
const hint = $("skillHint");
const createBtn = $("createBtn");
const form = $("sessionForm");

let accepted = [];
const partnerCache = {};

const preselect = new URLSearchParams(location.search).get("with");

const otherId = (connection) =>
  connection.participants.find((id) => id !== user.uid);

const otherName = (connection) =>
  connection.names?.[otherId(connection)] ||
  partnerCache[otherId(connection)]?.name ||
  "Your connection";

function todayStr() {
  return new Date(
    Date.now() - new Date().getTimezoneOffset() * 60000
  ).toISOString().slice(0, 10);
}

dateIn.min = todayStr();

function showConnectionError(error) {
  console.error("Connection loading failed:", error);

  withSel.innerHTML =
    '<option value="">Could not load connections</option>';

  $("noConnections").hidden = false;
  $("noConnections").textContent =
    "Could not load your connections. Please refresh the page.";

  createBtn.disabled = true;
  showError(error, "Could not load connections.");
}

// ---------- LOAD ACCEPTED CONNECTIONS ----------

onSnapshot(
  query(
    collection(db, "connections"),
    where("participants", "array-contains", user.uid)
  ),

  async (snap) => {
    accepted = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) =>
        c.status === "accepted" &&
        Array.isArray(c.participants) &&
        c.participants.includes(user.uid)
      );

    // Load partner names from their user profiles.
    await Promise.all(
      accepted.map(async (connection) => {
        const uid = otherId(connection);

        if (!uid || partnerCache[uid]) return;

        try {
          const userSnap = await getDoc(doc(db, "users", uid));

          partnerCache[uid] = userSnap.exists()
            ? userSnap.data()
            : { name: "Your connection", teach: [] };

        } catch (error) {
          console.error("Partner profile error:", error);
          partnerCache[uid] = {
            name: "Your connection",
            teach: []
          };
        }
      })
    );

    const previous = withSel.value;

    withSel.innerHTML = accepted.length
      ? accepted.map((connection) => `
          <option value="${esc(connection.id)}">
            ${esc(otherName(connection))}
          </option>
        `).join("")
      : '<option value="">No accepted connections yet</option>';

    const wanted = preselect
      ? accepted.find((c) => c.participants.includes(preselect))
      : null;

    if (previous && accepted.some((c) => c.id === previous)) {
      withSel.value = previous;
    } else if (wanted) {
      withSel.value = wanted.id;
    } else if (accepted.length) {
      withSel.selectedIndex = 0;
    }

    $("noConnections").hidden = accepted.length > 0;

    if (!accepted.length) {
      $("noConnections").textContent =
        "Accept a connection request before booking a session.";
    }

    await updateSkills();
  },

  showConnectionError
);

// ---------- LOAD SKILLS ----------

async function updateSkills() {
  skillSel.innerHTML = "";
  hint.textContent = "";
  createBtn.disabled = true;

  const connection = accepted.find(
    (c) => c.id === withSel.value
  );

  if (!connection) {
    skillSel.innerHTML =
      '<option value="">Select a connection first</option>';
    return;
  }

  try {
    let teachList = [];

    if (roleSel.value === "teach") {
      teachList = profile.teach || [];
    } else {
      const partnerUid = otherId(connection);

      if (!partnerCache[partnerUid]) {
        const snap = await getDoc(doc(db, "users", partnerUid));

        partnerCache[partnerUid] = snap.exists()
          ? snap.data()
          : { teach: [] };
      }

      teachList = partnerCache[partnerUid].teach || [];
    }

    if (!Array.isArray(teachList) || teachList.length === 0) {
      skillSel.innerHTML =
        '<option value="">No skills available</option>';

      hint.textContent =
        roleSel.value === "teach"
          ? "Add skills you can teach in your profile first."
          : `${otherName(connection)} has not listed any teaching skills yet.`;

      return;
    }

    skillSel.innerHTML = teachList.map((skill) => `
      <option
        value="${esc(skill.skillId)}"
        data-name="${esc(skill.name)}"
      >
        ${esc(skill.name)}
      </option>
    `).join("");

    createBtn.disabled = false;

  } catch (error) {
    console.error("Skill loading failed:", error);

    skillSel.innerHTML =
      '<option value="">Could not load skills</option>';

    hint.textContent =
      "Unable to load skills. Please refresh and try again.";

    showError(error, "Could not load skills.");
  }
}

withSel.addEventListener("change", updateSkills);
roleSel.addEventListener("change", updateSkills);

// ---------- BOOK SESSION ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const connection = accepted.find(
    (c) => c.id === withSel.value
  );

  if (!connection) {
    return toast("Choose an accepted connection first.", "error");
  }

  if (!skillSel.value) {
    return toast("Choose a skill first.", "error");
  }

  if (!dateIn.value || !timeIn.value) {
    return toast("Choose a date and time.", "error");
  }

  const startAt = new Date(
    `${dateIn.value}T${timeIn.value}`
  );

  if (isNaN(startAt.getTime()) || startAt <= new Date()) {
    return toast("Choose a future date and time.", "error");
  }

  const partnerUid = otherId(connection);
  const iTeach = roleSel.value === "teach";

  const teacherId = iTeach ? user.uid : partnerUid;
  const learnerId = iTeach ? partnerUid : user.uid;

  const option = skillSel.selectedOptions[0];

  if (!option) {
    return toast("Please select a skill.", "error");
  }

  setBusy(createBtn, true, "Scheduling...");

  try {
    await addDoc(collection(db, "sessions"), {
      teacherId,
      learnerId,

      teacherName: iTeach
        ? profile.name
        : otherName(connection),

      learnerName: iTeach
        ? otherName(connection)
        : profile.name,

      participants: [teacherId, learnerId],

      pairKey: connection.id,

      skillId: skillSel.value,
      skillName: option.dataset.name,

      date: dateIn.value,
      time: timeIn.value,

      durationMins: Number(durSel.value),

      startAt: Timestamp.fromDate(startAt),

      status: "scheduled",
      confirmedBy: [],
      rewarded: false,

      createdBy: user.uid,
      createdAt: serverTimestamp()
    });

    toast("Session scheduled successfully!", "success");

    form.reset();
    dateIn.min = todayStr();

    withSel.value = connection.id;

    await updateSkills();

  } catch (error) {
    console.error("Session booking failed:", error);
    showError(error, "Could not schedule session.");

  } finally {
    setBusy(createBtn, false);
  }
});

// ---------- SESSION STATUS ----------

const STATUS = {
  scheduled: ["Scheduled", ""],
  pending_confirmation: ["Pending confirmation", "badge-warn"],
  completed: ["Completed", "badge-ok"],
  cancelled: ["Cancelled", "badge-muted"],
  disputed: ["Disputed", "badge-bad"]
};

function sessionCard(s) {
  const iTeach = s.teacherId === user.uid;

  const partner = iTeach
    ? s.learnerName
    : s.teacherName;

  const [label, cls] =
    STATUS[s.status] || [s.status, ""];

  const mine = (s.confirmedBy || []).includes(user.uid);

  const theirs = (s.confirmedBy || []).some(
    (uid) => uid !== user.uid
  );

  const active = [
    "scheduled",
    "pending_confirmation"
  ].includes(s.status);

  let actions = "";
  let info = "";

  if (active) {
    if (!mine) {
      actions += `
        <button class="btn btn-primary btn-sm"
          data-act="confirm" data-id="${esc(s.id)}">
          Confirm completed
        </button>
      `;
    } else {
      info = `
        <p class="small muted">
          You confirmed. Waiting for ${esc(partner)}.
        </p>
      `;
    }

    if (theirs && !mine) {
      info = `
        <p class="small muted">
          ${esc(partner)} has already confirmed.
        </p>
      `;
    }

    actions += `
      <button class="btn btn-ghost btn-sm"
        data-act="report" data-id="${esc(s.id)}">
        Report a problem
      </button>

      <button class="btn btn-ghost btn-sm"
        data-act="cancel" data-id="${esc(s.id)}">
        Cancel
      </button>
    `;
  }

  if (s.status === "completed") {
    const xp = s.xpAwarded?.[user.uid] || 0;

    info = `
      <p class="small muted">
        ${xp
          ? `You earned +${xp} XP in ${esc(s.skillName)}.`
          : "No XP was awarded for this session."}
      </p>
    `;
  }

  if (s.status === "disputed") {
    info = `
      <p class="small muted">
        This session was reported and gives no XP.
      </p>
    `;
  }

  return `
    <article class="card session-card">
      <div class="session-top">
        <div>
          <h3>${esc(s.skillName || "Session")}</h3>
          <p class="muted small">
            ${iTeach ? "You teach" : "You learn from"}
            ${esc(partner || "your connection")}
          </p>
        </div>

        <span class="badge ${cls}">${label}</span>
      </div>

      <p class="small">
        ${esc(fmtDateTime(tsToDate(s.startAt)))}
        · ${Number(s.durationMins) || 0} min
      </p>

      ${info}

      <div class="card-actions">${actions}</div>
    </article>
  `;
}

// ---------- LIVE SESSION LIST ----------

onSnapshot(
  query(
    collection(db, "sessions"),
    where("participants", "array-contains", user.uid)
  ),

  (snap) => {
    const all = snap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    const startMs = (s) =>
      tsToDate(s.startAt)?.getTime() || 0;

    const active = all
      .filter((s) =>
        ["scheduled", "pending_confirmation"].includes(s.status)
      )
      .sort((a, b) => startMs(a) - startMs(b));

    const past = all
      .filter((s) =>
        !["scheduled", "pending_confirmation"].includes(s.status)
      )
      .sort((a, b) => startMs(b) - startMs(a));

    $("activeSessions").innerHTML = active.length
      ? active.map(sessionCard).join("")
      : '<p class="empty">No active sessions.</p>';

    $("pastSessions").innerHTML = past.length
      ? past.map(sessionCard).join("")
      : '<p class="empty">Completed and cancelled sessions will appear here.</p>';
  },

  (error) => {
    console.error("Session list failed:", error);

    $("activeSessions").innerHTML =
      '<p class="empty">Could not load sessions. Refresh the page.</p>';

    $("pastSessions").innerHTML = "";

    showError(error, "Could not load sessions.");
  }
);

// ---------- SESSION ACTIONS ----------

document.querySelector("main").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");

  if (!btn || !btn.dataset.id) return;

  const id = btn.dataset.id;

  if (btn.dataset.act === "confirm") {
    setBusy(btn, true, "Confirming...");

    try {
      const result = await confirmSession(id, user.uid);

      toast(
        result.message,
        result.status === "completed" ? "success" : "info"
      );

    } catch (error) {
      showError(error);
      setBusy(btn, false);
    }
  }

  if (btn.dataset.act === "cancel") {
    if (!confirm("Cancel this session?")) return;

    try {
      await updateDoc(doc(db, "sessions", id), {
        status: "cancelled",
        updatedAt: serverTimestamp()
      });

      toast("Session cancelled.", "success");

    } catch (error) {
      showError(error);
    }
  }

  if (btn.dataset.act === "report") {
    toast(
      "Problem reporting requires the server function, which is not enabled in this free-plan setup.",
      "info"
    );
  }
});
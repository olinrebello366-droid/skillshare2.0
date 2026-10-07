// Profile setup / edit page.
import { db } from "./firebase-config.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  requireUser,
  initials,
  toast,
  showError,
  setBusy
} from "./common.js";
import { loadSkills, createSkillPicker } from "./skills.js";

const { user, profile } = await requireUser({ needProfile: false });
const skills = await loadSkills();

const form = document.getElementById("profileForm");

form.elements.name.value =
  profile?.name || user.displayName || "";

form.bio.value =
  profile?.bio || "";

document.getElementById("pageTitle").textContent =
  profile?.profileComplete
    ? "Edit your profile"
    : "Set up your profile";

// ---------- Skills I can teach ----------
const teachPicker = createSkillPicker(
  document.getElementById("teachPicker"),
  {
    skills,
    placeholder: "Search skills you can teach...",
    selected: (profile?.teach || []).map((t) => ({
      skillId: t.skillId,
      name: t.name,
      category: t.category
    }))
  }
);

// ---------- Skills I want to learn ----------
const learnPicker = createSkillPicker(
  document.getElementById("learnPicker"),
  {
    skills,
    placeholder: "Search skills you want to learn...",
    selected: (profile?.learn || []).map((l) => ({
      skillId: l.skillId,
      name: l.name,
      category: l.category
    }))
  }
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = form.elements.name.value.trim();
  const bio = form.bio.value.trim();

  const teach = teachPicker.getSelected();
  const learn = learnPicker.getSelected();

  if (name.length < 2) {
    return toast("Please enter your name.", "error");
  }

  if (teach.length === 0 && learn.length === 0) {
    return toast(
      "Add at least one skill to teach or learn.",
      "error"
    );
  }

  const btn = form.querySelector(
    "button[type=submit]"
  );

  setBusy(btn, true, "Saving...");

  try {
    const profileData = {
      name,
      nameLower: name.toLowerCase(),
      bio,
      initials: initials(name),

      teach: teach.map((t) => ({
        skillId: t.skillId,
        name: t.name,
        category: t.category
      })),

      teachIds: teach.map((t) => t.skillId),

      learn: learn.map((l) => ({
        skillId: l.skillId,
        name: l.name,
        category: l.category
      })),

      learnIds: learn.map((l) => l.skillId),

      profileComplete: true,

      createdAt:
        profile?.createdAt || serverTimestamp(),

      updatedAt: serverTimestamp()
    };

    // New profiles start at 0 XP.
    // Existing profiles keep their current XP.
 if (
  !profile?.profileComplete ||
  typeof profile?.xp !== "number"
) {
  profileData.xp = 0;
}

    await setDoc(
      doc(db, "users", user.uid),
      profileData,
      { merge: true }
    );

    await updateProfile(user, {
      displayName: name
    });

    location.href = "dashboard.html";

  } catch (err) {
    showError(err);
    setBusy(btn, false);
  }
});
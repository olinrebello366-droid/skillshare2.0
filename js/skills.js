import { db } from "./firebase-config.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { esc } from "./common.js";

export const DEFAULT_CATEGORIES = {
  "Programming & IT": [
    "Python",
    "JavaScript",
    "Web Development",
    "Java",
    "C++",
    "SQL",
    "Git & GitHub",
    "Cybersecurity",
    "Mobile App Development",
    "Linux"
  ],

  "Design": [
    "Graphic Design",
    "UI/UX Design",
    "Figma",
    "Logo Design",
    "Video Editing",
    "Photoshop"
  ],

  "Creative Skills": [
    "Photography",
    "Drawing & Sketching",
    "Creative Writing",
    "Guitar",
    "Singing",
    "Calligraphy"
  ],

  "Business": [
    "Digital Marketing",
    "Entrepreneurship",
    "Financial Literacy",
    "Project Management",
    "Sales",
    "Excel"
  ],

  "Communication": [
    "Public Speaking",
    "English Speaking",
    "Interview Preparation",
    "Content Writing",
    "Negotiation",
    "Resume Writing"
  ],

  "Data & Analytics": [
    "Data Analysis",
    "Power BI",
    "Machine Learning",
    "Statistics",
    "Tableau",
    "Data Visualization"
  ],
};

export function slug(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

let cache = null;

export async function loadSkills() {
  if (cache) return cache;

  let list = Object.entries(DEFAULT_CATEGORIES).flatMap(
    ([category, names]) =>
      names.map((name) => ({
        id: slug(name),
        name,
        category
      }))
  );

  try {
    const snap = await getDocs(collection(db, "skills"));

    const firestoreSkills = snap.docs.map((d) => ({
      id: d.id,
      name: d.data().name,
      category: d.data().category
    }));

    const existingIds = new Set(list.map((skill) => skill.id));

    firestoreSkills.forEach((skill) => {
      if (!existingIds.has(skill.id)) {
        list.push(skill);
      }
    });
  } catch (e) {
    console.warn("Using local skill catalogue.", e);
  }

  list.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name)
  );

  cache = list;
  return list;
}

/**
 * Searchable multi-select.
 *
 * selected:
 * [{ skillId, name, category }]
 *
 * There is intentionally NO skill-level selector.
 * Overall user level is now calculated from total XP.
 */
export function createSkillPicker(
  root,
  {
    skills,
    selected = [],
    placeholder = "Search skills..."
  }
) {
  let items = selected.map((s) => ({ ...s }));

  root.classList.add("picker");

  root.innerHTML = `
    <input
      type="text"
      class="input picker-search"
      placeholder="${esc(placeholder)}"
      autocomplete="off"
    >

    <div class="picker-menu" hidden></div>

    <div class="chips"></div>
  `;

  const input = root.querySelector(".picker-search");
  const menu = root.querySelector(".picker-menu");
  const chips = root.querySelector(".chips");

  function renderMenu() {
    const q = input.value.trim().toLowerCase();
    const chosen = new Set(items.map((i) => i.skillId));

    const groups = {};

    skills
      .filter(
        (s) =>
          !chosen.has(s.id) &&
          (
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q)
          )
      )
      .forEach((s) => {
        (groups[s.category] = groups[s.category] || []).push(s);
      });

    const html = Object.keys(groups)
      .map(
        (cat) =>
          `<div class="picker-cat">${esc(cat)}</div>` +
          groups[cat]
            .map(
              (s) =>
                `<button
                  type="button"
                  class="picker-opt"
                  data-id="${esc(s.id)}"
                >${esc(s.name)}</button>`
            )
            .join("")
      )
      .join("");

    menu.innerHTML =
      html || `<div class="picker-empty">No matching skills</div>`;
  }

  function renderChips() {
    if (items.length === 0) {
      chips.innerHTML =
        `<span class="muted small">Nothing selected yet.</span>`;
      return;
    }

    chips.innerHTML = items
      .map(
        (i) => `
          <span class="chip">
            ${esc(i.name)}

            <button
              type="button"
              class="chip-x"
              data-id="${esc(i.skillId)}"
              aria-label="Remove ${esc(i.name)}"
            >&times;</button>
          </span>
        `
      )
      .join("");
  }

  input.addEventListener("focus", () => {
    renderMenu();
    menu.hidden = false;
  });

  input.addEventListener("input", () => {
    renderMenu();
    menu.hidden = false;
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) {
      menu.hidden = true;
    }
  });

  menu.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".picker-opt");

    if (!btn) return;

    const skill = skills.find((s) => s.id === btn.dataset.id);

    if (skill) {
      items.push({
        skillId: skill.id,
        name: skill.name,
        category: skill.category
      });
    }

    input.value = "";

    renderMenu();
    renderChips();
  });

  chips.addEventListener("click", (e) => {
    const x = e.target.closest(".chip-x");

    if (!x) return;

    items = items.filter(
      (i) => i.skillId !== x.dataset.id
    );

    renderChips();
    renderMenu();
  });

  renderMenu();
  renderChips();

  return {
    getSelected: () => items.map((i) => ({ ...i }))
  };
}
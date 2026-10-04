"use strict";
// Default skill catalogue. Keep in sync with js/skills.js (same names => same ids).
// The seedSkills function copies this into Firestore (collection "skills") once.
// After that you can add or rename skills directly in the Firebase console.

const CATEGORIES = {
  "Programming & IT": ["Python", "JavaScript", "Web Development", "Java", "C++", "SQL", "Git & GitHub", "Cybersecurity", "Mobile App Development", "Linux"],
  "Design": ["Graphic Design", "UI/UX Design", "Figma", "Logo Design", "Video Editing", "Photoshop"],
  "Creative Skills": ["Photography", "Drawing & Sketching", "Creative Writing", "Guitar", "Singing", "Calligraphy"],
  "Business": ["Digital Marketing", "Entrepreneurship", "Financial Literacy", "Project Management", "Sales", "Excel"],
  "Communication": ["Public Speaking", "English Speaking", "Interview Preparation", "Content Writing", "Negotiation", "Resume Writing"],
  "Data & Analytics": ["Data Analysis", "Power BI", "Machine Learning", "Statistics", "Tableau", "Data Visualization"]
};

function slug(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = { CATEGORIES, slug };

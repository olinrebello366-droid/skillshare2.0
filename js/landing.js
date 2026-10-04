// Landing page: show "Go to dashboard" when the visitor is already logged in.
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { configWarning } from "./common.js";

configWarning();

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  document.querySelectorAll("[data-guest]").forEach((el) => { el.hidden = true; });
  document.querySelectorAll("[data-member]").forEach((el) => { el.hidden = false; });
});

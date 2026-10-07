// Dashboard
// Shows the user's overall XP and level.
// Level is automatically calculated from total XP.

import { db } from "./firebase-config.js";

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  requireUser,
  esc,
  avatar,
  getThresholds,
  levelFromXp,
  levelProgress,
  tsToDate,
  fmtDateTime,
  showError
} from "./common.js";

const { user, profile } = await requireUser();

try {

  // ---------- LOAD LEVEL THRESHOLDS ----------

  const thresholds =
    await getThresholds();


  // ---------- LOAD DASHBOARD DATA ----------

  const [
    sessionsSnap,
    connSnap,
    xpEventsSnap
  ] = await Promise.all([

    // Sessions
    getDocs(
      query(
        collection(db, "sessions"),
        where(
          "participants",
          "array-contains",
          user.uid
        )
      )
    ),

    // Connections
    getDocs(
      query(
        collection(db, "connections"),
        where(
          "participants",
          "array-contains",
          user.uid
        )
      )
    ),

    // XP history
    getDocs(
      query(
        collection(db, "xpEvents"),
        where(
          "uid",
          "==",
          user.uid
        ),
        orderBy(
          "createdAt",
          "desc"
        ),
        limit(10)
      )
    ).catch((error) => {

      console.warn(
        "XP history could not be loaded.",
        error
      );

      return {
        docs: []
      };
    })

  ]);


  const sessions =
    sessionsSnap.docs.map(
      (d) => ({
        id: d.id,
        ...d.data()
      })
    );


  const conns =
    connSnap.docs.map(
      (d) => ({
        id: d.id,
        ...d.data()
      })
    );


  const xpEvents =
    xpEventsSnap.docs.map(
      (d) => ({
        id: d.id,
        ...d.data()
      })
    );


  // ---------- RENDER DASHBOARD ----------

  renderWelcome();
  renderSummary();
  renderLevel();
  renderUpcoming();
  renderRequests();
  renderActivity();


  // =========================================================
  // WELCOME
  // =========================================================

  function renderWelcome() {

    const firstName =
      profile?.name?.split(" ")[0] ||
      "there";


    document.getElementById(
      "welcome"
    ).textContent =
      `Welcome back, ${firstName}`;
  }


  // =========================================================
  // PROFILE SUMMARY
  // =========================================================

  function renderSummary() {

    const completed =
      sessions.filter(
        (s) =>
          s.status === "completed"
      ).length;


    const connected =
      conns.filter(
        (c) =>
          c.status === "accepted"
      ).length;


    document.getElementById(
      "summary"
    ).innerHTML = `

      <div class="profile-head">

        ${avatar(
          profile.name,
          "lg"
        )}

        <div>

          <h2>
            ${esc(profile.name)}
          </h2>

          <p class="muted">

            ${esc(
              profile.bio ||
              "Add a short bio so people know who you are."
            )}

          </p>

        </div>

      </div>


      <div class="stat-row">

        <div>

          <strong>
            ${(profile.teach || []).length}
          </strong>

          <span>
            skills teaching
          </span>

        </div>


        <div>

          <strong>
            ${(profile.learn || []).length}
          </strong>

          <span>
            skills learning
          </span>

        </div>


        <div>

          <strong>
            ${connected}
          </strong>

          <span>
            connections
          </span>

        </div>


        <div>

          <strong>
            ${completed}
          </strong>

          <span>
            sessions completed
          </span>

        </div>

      </div>


      <a
        class="btn btn-ghost btn-sm"
        href="profile-setup.html"
      >
        Edit profile
      </a>

    `;
  }


  // =========================================================
  // OVERALL XP + LEVEL
  // =========================================================

  function renderLevel() {

    const wrap =
      document.getElementById(
        "skillLevels"
      );


    // XP is stored on the user profile.
    // New users start at 0 XP.

    const xp =
      Number.isFinite(
        Number(profile?.xp)
      )
        ? Number(profile.xp)
        : 0;


    const level =
      levelFromXp(
        xp,
        thresholds
      );


    const progress =
      levelProgress(
        xp,
        thresholds
      );


    let nextLevelText = "";


    if (level >= 5) {

      nextLevelText =
        "You have reached the maximum level!";

    } else {

      const nextThreshold =
        thresholds[level];


      const remaining =
        Math.max(
          0,
          nextThreshold - xp
        );


      nextLevelText =
        `${remaining} XP needed for Level ${level + 1}`;
    }


    wrap.innerHTML = `

      <div class="skill-row">

        <div class="skill-top">

          <strong>
            Level ${level}
          </strong>


          <span class="level-pill">
            ${xp} XP
          </span>

        </div>


        <div
          class="bar"
          role="progressbar"
          aria-valuenow="${progress.pct}"
          aria-valuemin="0"
          aria-valuemax="100"
        >

          <span
            style="width:${progress.pct}%"
          ></span>

        </div>


        <div class="muted small">

          ${esc(
            nextLevelText
          )}

        </div>

      </div>


      <div
        class="muted small"
        style="margin-top: 10px;"
      >

        Your level is automatically based
        on your total XP.
        You cannot manually change your level.

      </div>

    `;
  }


  // =========================================================
  // UPCOMING SESSIONS
  // =========================================================

  function renderUpcoming() {

    const wrap =
      document.getElementById(
        "upcoming"
      );


    const list =
      sessions
        .filter(
          (s) =>
            [
              "scheduled",
              "pending_confirmation"
            ].includes(
              s.status
            )
        )
        .sort(
          (a, b) =>
            tsToDate(a.startAt) -
            tsToDate(b.startAt)
        )
        .slice(0, 4);


    if (
      list.length === 0
    ) {

      wrap.innerHTML = `

        <p class="empty">

          No upcoming sessions.

          <a href="sessions.html">
            Schedule one
          </a>.

        </p>

      `;

      return;
    }


    wrap.innerHTML =
      list
        .map((s) => {

          const iTeach =
            s.teacherId === user.uid;


          const partner =
            iTeach
              ? s.learnerName
              : s.teacherName;


          return `

            <a
              class="list-item"
              href="sessions.html"
            >

              <strong>
                ${esc(
                  s.skillName
                )}
              </strong>


              <span class="muted small">

                ${
                  iTeach
                    ? "Teaching"
                    : "Learning from"
                }

                ${esc(
                  partner
                )}

                ·

                ${esc(
                  fmtDateTime(
                    tsToDate(
                      s.startAt
                    )
                  )
                )}

              </span>

            </a>

          `;

        })
        .join("");
  }


  // =========================================================
  // CONNECTION REQUESTS
  // =========================================================

  function renderRequests() {

    const wrap =
      document.getElementById(
        "requests"
      );


    const pending =
      conns.filter(
        (c) =>
          c.status === "pending" &&
          c.receiverId === user.uid
      );


    if (
      pending.length === 0
    ) {

      wrap.innerHTML = `

        <p class="empty">
          No pending requests.
        </p>

      `;

      return;
    }


    wrap.innerHTML =
      pending
        .map(
          (c) => `

            <a
              class="list-item"
              href="connections.html"
            >

              <strong>

                ${esc(
                  c.names?.[
                    c.requesterId
                  ] ||
                  "Someone"
                )}

              </strong>


              <span class="muted small">

                wants to connect
                with you

              </span>

            </a>

          `
        )
        .join("");
  }


  // =========================================================
  // XP + RECENT ACTIVITY
  // =========================================================

  function renderActivity() {

    const items = [];


    // ---------- XP EVENTS ----------

    xpEvents.forEach(
      (event) => {

        const xp =
          Number(event.xp) || 0;


        let label =
          "for XP";


        if (
          event.type ===
          "teaching"
        ) {

          label =
            "for teaching";

        } else if (
          event.type ===
          "learning"
        ) {

          label =
            "for learning";
        }


        items.push({

          at:
            tsToDate(
              event.createdAt
            ),

          text:
            `+${xp} XP ${label}`
        });

      }
    );


    // ---------- SESSION ACTIVITY ----------

    sessions.forEach(
      (s) => {

        const at =
          tsToDate(
            s.updatedAt
          ) ||
          tsToDate(
            s.createdAt
          );


        const label = {

          completed:
            "completed",

          cancelled:
            "cancelled",

          disputed:
            "reported"

        }[s.status];


        if (label) {

          items.push({

            at,

            text:
              `Session "${s.skillName}" ${label}`

          });

        }

      }
    );


    const wrap =
      document.getElementById(
        "activity"
      );


    items.sort(
      (a, b) =>
        (b.at || 0) -
        (a.at || 0)
    );


    if (
      items.length === 0
    ) {

      wrap.innerHTML = `

        <p class="empty">

          Nothing yet.

          Your sessions and XP
          will show up here.

        </p>

      `;

      return;
    }


    wrap.innerHTML =
      items
        .slice(0, 6)
        .map(
          (item) => `

            <div class="list-item">

              <span>
                ${esc(
                  item.text
                )}
              </span>


              <span class="muted small">

                ${esc(
                  fmtDateTime(
                    item.at
                  )
                )}

              </span>

            </div>

          `
        )
        .join("");
  }


} catch (error) {

  console.error(
    "Dashboard error:",
    error
  );


  showError(
    error,
    "Could not load your dashboard."
  );
}
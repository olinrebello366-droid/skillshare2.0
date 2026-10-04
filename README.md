# SkillShare 2.0

**Learn. Teach. Earn. Level Up.**

A peer-to-peer skill exchange web app. People teach skills they know, learn skills from others, and earn XP in each skill when both people confirm a session.

Built with plain **HTML5, CSS3 and vanilla JavaScript** plus **Firebase** (Authentication, Firestore, Cloud Functions, Hosting). No frameworks, no build step.

---

## 1. Folder structure

```
SkillShare2/
├── index.html            Landing page
├── login.html            Log in
├── register.html         Sign up
├── profile-setup.html    Create / edit profile and pick skills
├── dashboard.html        Personal dashboard
├── explore.html          Find people by skill
├── connections.html      Requests and accepted connections
├── chat.html             Real-time chat
├── sessions.html         Schedule, confirm, report, review
├── css/                  style.css (shared), auth.css, dashboard.css
├── js/
│   ├── firebase-config.js   <-- YOU EDIT THIS (your Firebase keys)
│   ├── common.js            login guard, nav bar, helpers
│   ├── auth.js, profile.js, skills.js, dashboard.js, explore.js,
│   ├── connections.js, chat.js, sessions.js, rewards.js, landing.js
├── functions/            Cloud Functions (secure XP rewards)
│   ├── index.js, skills-data.js, package.json
├── firestore.rules       Security rules
├── firestore.indexes.json
├── firebase.json, .firebaserc
└── README.md
```

## 2. How it works (simple version)

- The **website** is static files. Your browser runs the JavaScript.
- **Firebase Authentication** handles sign-up and login.
- **Firestore** stores profiles, connections, chats and sessions.
- **Cloud Functions** are the only thing that can give out XP. The browser can say "I confirm this session" but cannot say "give me XP".
- **Firestore rules** decide who can read or write each document.

## 3. Firestore collections

| Collection | Purpose | Who can write |
|---|---|---|
| `users/{uid}` | Name, bio, skills taught and wanted (no XP here) | The user |
| `users/{uid}/skillStats/{skillId}` | XP, level, sessions per skill | Cloud Functions only |
| `skills/{skillId}` | Skill catalogue (edit in the console to add skills) | Cloud Functions / console |
| `config/levels` | XP thresholds, e.g. `thresholds: [0,100,300,600,1000]` | Console |
| `connections/{uidA_uidB}` | Request status; `messages` sub-collection holds the chat | Participants (limited) |
| `sessions/{id}` | Teacher, learner, skill, time, status, confirmations | Create/cancel by users; the rest by Functions |
| `rewards/{sessionId_uid}` | Reward history (one per user per session) | Functions only |
| `dailyXp/{uid_date}` | Tracks the daily XP cap | Functions only |
| `pairs/{pairKey}` | Recent rewarded sessions between two people | Functions only |
| `reviews`, `reports` | Feedback and problem reports | Functions only |

## 4. Setup

You need: a Google account, **Node.js 20 LTS** (nodejs.org), and a code editor such as VS Code.

### Step 1 - Create the Firebase project
1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it, for example `skillshare2`.

### Step 2 - Turn on Authentication
Build -> **Authentication** -> Get started -> **Email/Password** -> Enable -> Save.

### Step 3 - Create the database
Build -> **Firestore Database** -> Create database -> **Production mode**. Choose a region near you (for example `asia-south1` Mumbai).

### Step 4 - Register the web app and paste your keys
1. Project overview -> click the **</>** (Web) icon -> register the app (skip Hosting for now).
2. Copy the `firebaseConfig` values.
3. Open `js/firebase-config.js` and replace every `PASTE_...` value.

### Step 5 - Install the Firebase tools
```
npm install -g firebase-tools
firebase login
```
Open `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your project id.

### Step 6 - Deploy rules and indexes
From the `SkillShare2` folder:
```
firebase deploy --only firestore
```
The reward-history query needs the index in `firestore.indexes.json`; it is created by this command (it can take a few minutes to build).

### Step 7 - Deploy the Cloud Functions
Cloud Functions need the **Blaze (pay-as-you-go) plan** (Firebase console -> Upgrade). A project this size normally stays inside the free allowance, but Google asks for a billing method.
```
cd functions
npm install
cd ..
firebase deploy --only functions
```
If you choose a different region than `asia-south1`, change it in **both** `functions/index.js` (`setGlobalOptions`) and `js/firebase-config.js` (`FUNCTIONS_REGION`).

### Step 8 - Run it locally
Browsers block JavaScript modules when you double-click an HTML file, so use a tiny local server:
```
npx serve .
```
Open the address it prints (usually http://localhost:3000). `localhost` is allowed by Firebase Authentication automatically.

### Step 9 - Put it online
```
firebase deploy --only hosting
```
Your site appears at `https://YOUR_PROJECT_ID.web.app`. (Vercel also works: import the folder as a static site with no build command.) If you use another domain, add it under Authentication -> Settings -> Authorized domains.

## 5. Testing checklist

Use two accounts: one in a normal browser window, one in a private window.

1. Register account A, finish profile setup (add a teachable skill).
2. Register account B, finish profile setup.
3. A: Explore -> find B -> **Connect**. B: Connections -> **Accept**.
4. Both: open **Chat** and send messages (they appear instantly on both sides).
5. A: Sessions -> schedule a session (A learns, B teaches).
6. Try **Confirm completed** right away: it is refused (the session has not run for 10 minutes yet).
7. To test XP quickly, open `functions/index.js`, set `TESTING_MODE: true`, redeploy functions (`firebase deploy --only functions`). **Set it back to `false` afterwards.**
8. A confirms -> status becomes *Pending confirmation*. B confirms -> *Completed*; B gets +30 XP, A gets +20 XP in that skill (check the dashboard).
9. Leave feedback on the completed session: +5 XP once per person.
10. Try to confirm again: refused. XP cannot be given twice.

## 6. Anti-farming safeguards (what is built in)

- Both people must confirm; one confirmation keeps the session *Pending confirmation*.
- Participants and skill are validated on the server (the skill must be on the teacher's profile).
- A reward document with a fixed id (`sessionId_uid`) blocks duplicate rewards.
- Daily XP cap per user (default 100) and a limit on rewarded sessions between the same two people (default 3 per 7 days).
- Confirmation is only possible 10 minutes after the scheduled start.
- Full reward history is stored in `rewards`.
- Users cannot edit XP or levels: those documents are write-protected by the rules.
- Problem reports mark the session *Disputed* and store a report.

**Honest limitation:** two people can still agree to confirm a session that never happened. These safeguards make that slow and low-value, but they cannot prove a real session took place. Review the `reports` collection regularly and adjust the limits in `functions/index.js` (`CONFIG`).

## 7. Customising

- **Levels:** edit `config/levels` in Firestore (`thresholds` array). Defaults: 0, 100, 300, 600, 1000.
- **XP values and limits:** `CONFIG` at the top of `functions/index.js`.
- **Skills:** add documents to the `skills` collection (fields `name`, `category`; the document id should be a lowercase slug such as `public-speaking`).
- **Colors:** the variables at the top of `css/style.css`.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Yellow banner "Firebase is not configured" | Fill in `js/firebase-config.js` |
| Blank page / module errors | Use `npx serve .` instead of opening the file directly |
| "Permission denied" toast | Run `firebase deploy --only firestore` |
| "Cloud Functions are not deployed" | Complete Step 7 (Blaze plan required) |
| Recent activity shows no XP | The index is still building, or run Step 6 |

# Tippklar — 60-second German typing test

A ready-to-host static typing test, plus a small optional Cloudflare Worker that issues **cryptographically signed, fixed result links**.

**Website:** HTML + CSS + vanilla JavaScript, hosted on GitHub Pages.
**Verification service:** Cloudflare Worker, hosted on `*.workers.dev` (free tier for small use).
**Database:** none.
**User accounts / analytics / cookies / personal-best storage:** none.

## Features

- Desktop browsers only: the full typing interface is designed for screens wider than 800 CSS pixels. Smaller viewports show an explanatory desktop-only notice instead of a mobile typing-test layout.
- German only, a fixed 60-second time window.
- **Keyboard-first start:** with the page focused, press **Tab** to prepare the test and focus the typing field, or click **Test vorbereiten**. The 60-second countdown starts only with the first typed character, not with the Tab key. Tab retains normal navigation behavior when a link or button is already focused.
- Minimal, desktop-only presentation with no promotional hero, feature tiles, or footer.
- Independently randomized words (not sentences), new set each round.
- Highlighting for individual correct, wrong, and next-to-type characters.
- No WPM or accuracy displayed while the timer is running.
- After 60 seconds: WPM, accuracy, correct characters, incorrect characters.
- No history or best score saved.
- Share by system share dialog or copying an **immutable, signed result-page link** when the Worker is configured.
- No dependencies for the site, no third-party fonts or tracking scripts.

### IMPORTANT: what “verified” means

The Worker sends the challenge words, checks at least 60 seconds of real server time have elapsed since its start, **calculates the result itself from the submitted final text**, and signs an immutable receipt with HMAC-SHA256. On a shared `/r/...` page, it checks the signature before displaying the values. The recipient cannot change those numbers by editing URL parameters. No database is needed because the link carries a signed receipt.

**This is tamper-evident sharing, NOT proof of human typing or robust anti-cheat.** A technically sophisticated person can still falsify the original browser input (for example through browser developer tools), let the server's 60 seconds pass, then receive a legitimate signature on falsified data. It is impossible to guarantee authentic human typing with an ordinary static browser application. Do not use it as the sole evidence for high-stakes hiring/examinations. Screenshots can also be edited: ask users to send the **actual signed link**.

## File layout

```text
README.md
package.json
/docs/                 <-- GitHub Pages serves ONLY this folder
  .nojekyll
  index.html
  styles.css
  app.js
  words.js
  config.js             <-- put your Worker URL here, no secret
  favicon.svg
/worker/               <-- Cloudflare Worker backend; GitHub Pages does NOT serve it
  worker.js
  wrangler.toml         <-- set your public site URL here, no secret
/tests/
  worker.test.js
```

## Step 1 — Test locally without a backend

1. Unzip the downloaded project.
2. Open a terminal inside `deutsch-typing-test/docs`.
3. Start a local server:
   - macOS/Linux: `python3 -m http.server 8000`
   - Windows: `py -m http.server 8000`
4. Visit <http://localhost:8000>.
5. With the page focused, press **Tab** (or click **Test vorbereiten**). The input will receive focus, and the timer will remain at 60 until you type the first character. Test the red/green feedback and end-of-test metrics. Screens 800 CSS pixels wide or narrower intentionally show a desktop-only notice.

The site is fully usable without a Worker; **the verified share buttons are intentionally disabled** until a verification Worker is configured. Opening `index.html` as a `file://` URL is not recommended because ES module imports are usually restricted for local files.

## Step 2 — Host the site with GitHub Pages

1. Sign in to GitHub and create a new repository, for example `tippklar`.
2. Upload the contents of the unzipped project (including the `docs/` and `worker/` folders) to the repository's `main` branch. You may use Git on your computer, or GitHub's **Add file → Upload files**. Keep the directory structure intact.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select **Branch: `main`**, **Folder: `/docs`**, and click **Save**.
6. When GitHub finishes publishing, visit:

   `https://YOUR_GITHUB_USERNAME.github.io/tippklar/`

Replace `YOUR_GITHUB_USERNAME` and `tippklar` with your actual GitHub username and repository name. Publication can take a few minutes.

**At this point the typing test works, but result sharing is not yet signed.**

Official guide: <https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>

## Step 3 — Set up the signature Worker (needed for non-editable result links)

A GitHub Pages website cannot privately hold a signing key. For immutable result pages, deploy the included Worker on Cloudflare.

1. Create a Cloudflare account at <https://dash.cloudflare.com/>.
2. Install **Node.js 22 or newer** if you do not already have Node.js. A terminal is needed for these commands; you do *not* need to rent a server.
3. Open `worker/wrangler.toml` in a text editor and replace both placeholders:

   ```toml
   [vars]
   ALLOWED_ORIGINS = "https://YOUR_GITHUB_USERNAME.github.io"
   SITE_URL = "https://YOUR_GITHUB_USERNAME.github.io/tippklar/"
   ```

   `ALLOWED_ORIGINS` is your **origin**, without the repository path. `SITE_URL` is the **full GitHub Pages URL**, including the repository path and trailing slash.

   If you publish under a custom domain, replace both with your actual HTTPS domain / URL instead. To permit two origins, separate them with commas (for example your GitHub Pages site and a staging domain).
4. In a terminal open the `worker` directory:

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

   Authorize Cloudflare login in your browser. On deployment, Wrangler prints an HTTPS URL, typically:

   `https://tippklar-verification.YOUR_CLOUDFLARE_SUBDOMAIN.workers.dev`

5. Generate a strong secret **locally** (do not commit it to GitHub):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the printed random string somewhere secure.
6. Add the secret to Cloudflare's secure Worker environment:

   ```bash
   npx wrangler secret put SIGNING_SECRET
   ```

   When prompted, paste your random string. This creates a new deployment with the secret. **Never put `SIGNING_SECRET` in `wrangler.toml`, `config.js`, or the GitHub repository.**
7. Visit your Worker's `/health` URL, for example:

   `https://tippklar-verification.YOUR_CLOUDFLARE_SUBDOMAIN.workers.dev/health`

   You should see a small JSON response such as `{"ok":true,"service":"tippklar-signatures"}`.

Cloudflare Workers documentation: <https://developers.cloudflare.com/workers/get-started/dashboard/> and <https://developers.cloudflare.com/workers/configuration/secrets/>.

## Step 4 — Connect the website to the Worker

1. Edit `docs/config.js` and paste the **actual HTTPS Worker URL** (no slash at the end):

   ```js
   window.TYPING_CONFIG = {
     apiBaseUrl: 'https://tippklar-verification.YOUR_CLOUDFLARE_SUBDOMAIN.workers.dev'
   };
   ```

2. Commit and push `docs/config.js` to your GitHub repository (or edit it directly in GitHub using the pencil icon and choose **Commit changes**).
3. Refresh the GitHub Pages site after it republishes.
4. Press **Tab** while the page is focused (or click **Test vorbereiten**). Begin typing to start the 60-second countdown; after the time expires, wait for **Server-signiert ✓**.
5. Press **Link kopieren**. Open the URL in another browser or private browsing window. The result page should say **Serversignatur gültig**.
6. For an integrity check, modify one character inside the token in the `/r/...` link: it should return `404` and **not** display a valid result.

Participants can now send you the **signed Worker link** using email, a chat app, or your preferred form. No email address or additional service is built into the test.

## Scoring

- **Correct characters:** Number of positions in the final typed text that exactly match the randomized challenge, including spaces.
- **WPM:** Correct characters / 5, because the test lasts one minute.
- **Accuracy:** Correct characters / all characters in the final typed text × 100%.
- **Errors:** Incorrect positions in the final typed text.
- The user can backspace and correct errors. The score measures the **final text**, not the total number of historical keystrokes. Corrections therefore remove previous errors from the final accuracy figure.
- Results are revealed **only after the full 60 seconds of actual typing time**, measured from the first character entered after preparation.
- For signed sharing, a Cloudflare Worker session is created during **preparation** (when Tab or the button is pressed). The Worker enforces at least 60 seconds of server time from that point, and the browser enforces the full 60 seconds from the first typed character. If a prepared session sits idle for more than eight minutes, it must be prepared again. This does not constitute anti-cheat or independent proof of human typing.

## Privacy, links, limits, and maintenance

- The static website stores no personal bests, sessions, cookies, or test history. A test exists only in memory while the page is open.
- A **signed result link is itself a portable record** containing the score, issue date, and a random run ID. No database stores those records. Keep the link if you need it later.
- The backend sees the submitted typing text and computes a signature. It does **not** save the typed text or email it anywhere. Host providers may keep ordinary infrastructure/access logs.
- **Do not rotate or lose `SIGNING_SECRET`** unless you intentionally want previously issued links to become invalid. Do not rename/delete the Worker without planning for old links.
- The Worker applies an origin allow-list for browsers; this is not a bot-defense mechanism (HTTP clients can forge `Origin`). If misuse becomes a concern, add rate limiting, bot protection, per-session event logging, and/or human review.
- Cloudflare Workers has a free tier with usage limits. Check current pricing and quota before significant public distribution.
- The code has no external fonts, trackers, libraries, or advertisements. An HTTPS connection to the configured Worker is made to start and sign each verified test.

## Optional testing

From the project root, with Node.js 22 or newer:

```bash
npm test
```

The tests verify the 60-second server-side timing, word pool, scoring, valid signatures, changed-link rejection, browser-origin settings, and expired sessions.

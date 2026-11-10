# Build prompt: "Free Up Space" setup page on prosperahq.io

> Paste everything below the line into the LLM that will build the page. Fill in the four `{{PLACEHOLDERS}}` first (see the end of the brief). The userscript side of the contract is already implemented in this repo (`src/setup-bridge.ts`, version `4.0.0-cleanup.2` and later), so do not change it here.

---

## Role and goal

You are building one private web page at **`https://prosperahq.io/GooglePhotos/`**. A non-technical family member (often a teenager) lands on it from a link Paul texts them. The page must take them from "nothing installed" to **the Free Up Space wizard open inside Google Photos** with as few clicks and as little reading as possible. The page checks what is already done, skips those steps, and verifies each step for real instead of trusting a checkbox.

The thing being installed is a Tampermonkey userscript ("Google Photos Toolkit - Cleanup") that adds a cleanup wizard to photos.google.com. A web page cannot install browser extensions itself, so the page's job is to (1) detect, (2) give exactly one obvious next action, (3) confirm it worked automatically, and (4) launch the wizard.

## Hard constraints

- **Desktop Google Chrome only.** Other browsers and phones get a friendly "use Chrome on a computer" screen (details below).
- **Framework-neutral.** Build it as a self-contained static page: one `index.html` with inline CSS and vanilla JS, no build step and no external JS libraries. If the site's stack needs it, wrap that same markup in the stack's page format, but keep the logic plain JS.
- **Served files.** The same folder must serve, as static files copied from the toolkit repo's `dist-site/` output:
  - `/GooglePhotos/gptk.user.js` (the userscript, ~380 KB)
  - `/GooglePhotos/gptk.meta.js` (header only, ~8 KB)
  Serve both with `Content-Type: text/javascript; charset=utf-8` and `Cache-Control: no-cache`. Do not minify, rename or rewrite them. Tampermonkey intercepts URLs ending in `.user.js`, so the file name must stay exactly `gptk.user.js`.
- **Private.** Add `<meta name="robots" content="noindex,nofollow">`, no links to this page from site navigation or the sitemap, and a `Disallow: /GooglePhotos/` line in robots.txt.
- **Passcode gate** (see "Screen 0"). It only stops casual visitors. The script file itself stays reachable, and that is acceptable.
- **Writing style:** no em dashes anywhere (use a hyphen). Short sentences, at most ~12 words per instruction line, second person, friendly, no jargon ("add-on" is fine, but never "userscript", "manifest" or "API").
- **No purple** anywhere in the palette.
- No analytics, cookies or third-party calls except Google Fonts (Montserrat) and links out to the Chrome Web Store and photos.google.com.

## Branding

Match the wizard the user is about to see:

| Token | Value | Use |
|---|---|---|
| `--p-dark` | `#09122B` | Text; page background in dark mode |
| `--p-navy` | `#1D2B52` | Secondary text; cards in dark mode |
| `--p-green` | `#14B87C` | Primary buttons, completed-step checks, progress |
| `--p-green-2` | `#6CC852` | Hover states |
| `--p-gradient` | `linear-gradient(135deg, #14B87C, #D4DC1E)` | Progress bar, final success state |
| `--p-faded` | `#B1B2C9` | Borders and dividers only, never an accent fill |
| `--p-danger` | `#D93025` | Error states only |

- Font: Montserrat 400/600/700 from Google Fonts, falling back to the system stack.
- Logo: Prospera horizontal logo top-left, 200px wide. Copy `media/brand/prospera-logo-light.png` and `prospera-logo-dark.png` from the toolkit repo next to the page, and swap to the dark one under `prefers-color-scheme: dark`. Never stretch or recolor it.
- White cards, 12px radius, soft shadow, 44px minimum tap targets, generous whitespace. Support light and dark mode.
- Footer: a thin `#B1B2C9` rule, then "Prospera  •  www.Prosperahq.io" on the left and the latest script version (read from `gptk.meta.js`) on the right.

## The integration contract (already implemented in the userscript)

The userscript also runs on `https://www.prosperahq.io/GooglePhotos*` (plus `prosperahq.io`, `localhost` and `127.0.0.1` under the same path, for testing). On this page it does not start the toolkit. It only talks to the page through DOM events on `document` and `data-*` attributes on `<html>`. The page and the script run in separate JS worlds, so use only these channels. There is no shared `window` variable.

| Direction | Signal | Meaning |
|---|---|---|
| script → page | `<html data-gptk-version="4.0.0-cleanup.2">` | Script installed **and running**. That proves Tampermonkey is installed, user scripts are allowed, and the script is enabled. |
| script → page | `<html data-gptk-handler="Tampermonkey 5.3.3">` | Extension name and version, for diagnostics |
| script → page | `document` event `gptk-installed` | Fired when the script announces (on load and after each ping) |
| page → script | `document.dispatchEvent(new Event('gptk-ping'))` | Ask the script to re-announce |
| page → script | `document.dispatchEvent(new Event('gptk-open-request'))` | Arm auto-open. The next Google Photos load within 10 minutes opens the wizard by itself, even after a Google sign-in redirect. |
| script → page | `<html data-gptk-open-armed="1">` plus event `gptk-open-armed` | Auto-open is armed |
| URL | `https://photos.google.com/#gptk-open` | Also opens the wizard (fallback, when the hash survives) |

The script may load before or after the page's JS, so detection must:

1. Check `document.documentElement.dataset.gptkVersion` right away.
2. Listen for `gptk-installed`.
3. Fire `gptk-ping` once on load, then again every 2 s while a "waiting" step is visible, and immediately on `visibilitychange` (to visible) and `focus`. That's how the page notices the user came back from the Tampermonkey install tab.
4. Treat "no version after 2.5 s of pinging" as **not detected**.

Wrap all of this in one helper, e.g. `detectScript(): Promise<{version, handler} | null>`, plus a `watchForScript(callback)` used by the waiting steps.

**Latest version:** `fetch('gptk.meta.js', {cache: 'no-store'})` and parse `/@version\s+(\S+)/`. Compare it with the installed version using a simple segment-by-segment comparison that handles the `-cleanup.N` suffix.

## Screens (a state machine, one screen visible at a time)

Show a slim 4-dot progress indicator ("Add-on helper", "Allow it", "Install", "Open") on screens 2-5. Steps already done show a green check. All state is derived from live detection on every load, never stored. The only thing stored is the passcode unlock flag.

### Screen 0 - Passcode
- Single field "Family passcode" plus a "Continue" button. Enter submits.
- Compare `SHA-256(lowercase(trim(input)))` with the hard-coded hex `{{PASSCODE_SHA256}}` using `crypto.subtle`. On success, save `localStorage['gptk-setup-unlocked'] = '1'` (wrapped in try/catch) and continue. Once unlocked, skip this screen on later visits.
- Wrong code: shake, then "That's not it. Ask Paul for the code." No lockout.
- Support `?code=...` in the URL so Paul can text a one-tap link. Validate it the same way, then remove it from the address bar with `history.replaceState`.

### Screen 1 - Environment check (automatic, about 1 s, shows a spinner "Checking your computer...")
Decide in this order:
1. **Phone or tablet** (`navigator.userAgentData?.mobile`, or a UA test for Android/iPhone/iPad, or `maxTouchPoints > 1` on a Mac-like UA): show "This works on a computer, not a phone." Offer two buttons: "Email me this link" (`mailto:` with subject "Photos cleanup link" and the page URL in the body) and "Copy link". Stop here.
2. **Not Google Chrome**: detect with `navigator.userAgentData?.brands` containing "Google Chrome". Edge, Brave, Opera, Arc, Safari and Firefox all fail this check. Show "Please open this page in Google Chrome," with a "Copy link" button and a "Get Chrome" link to https://www.google.com/chrome/. Stop here.
3. Read the Chrome major version (from `userAgentData.brands` or the UA). Remember whether it is **>= 138**, because that decides which permission instructions to show on Screen 3.
4. Run `detectScript()`:
   - Detected and version >= latest: go to **Screen 5 (Ready)**.
   - Detected but older: go to **Screen 5** with a small notice and an "Update now" button that links to `gptk.user.js` (Tampermonkey shows its update dialog). Keep the main "Open" button working.
   - Not detected: go to **Screen 2**.

### Screen 2 - Add the helper (Tampermonkey)
- Headline: "Step 1: Add the free helper."
- One sentence: "Tampermonkey is a free Chrome add-on that runs our cleanup tool."
- Big primary button "Add Tampermonkey to Chrome". It opens `https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo` in a new tab.
- A 3-frame illustration or a `{{GIF_ADD_TO_CHROME}}` placeholder: "Click **Add to Chrome**, then **Add extension**. Then come back to this tab."
- Secondary button "I've added it" leads to Screen 3.
- Small text link "I already have Tampermonkey" also leads to Screen 3.
- Note for the builder: Tampermonkey cannot be detected by itself, so this step is self-reported. Screen 4's ping verifies it for real.

### Screen 3 - Allow it to run (the step people miss)
Chrome hides user scripts until the user allows them. Show the instructions that match the Chrome version:

- **Chrome 138 or newer:**
  1. "Click **Copy** below, paste it into a new tab's address bar, and press Enter." Show a read-only field `chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo` with a **Copy** button. Web pages cannot link to `chrome://` URLs, so copy and paste is the only way.
  2. "Turn on **Allow User Scripts**."
  3. "Come back to this tab."
  `{{GIF_ALLOW_USER_SCRIPTS}}` placeholder.
- **Chrome 120-137:** same copy field, but the instruction is to go to `chrome://extensions` and turn on **Developer mode** (top-right switch).
- Primary button "Done, next" leads to Screen 4.
- Tip below: "Using a work or school computer? Your admin may block this. Try a personal computer."

### Screen 4 - Install the cleanup tool
- Headline: "Step 3: Install the cleanup tool."
- Primary button "Install Free Up Space". It is a plain `<a href="gptk.user.js">` link, so Tampermonkey intercepts it and opens its install tab. It must not be a download.
- Instruction: "A Tampermonkey tab opens. Click **Install**. Then come back here."
- `{{GIF_INSTALL_SCRIPT}}` placeholder.
- After the click, show a live status line "Waiting for the tool..." with a spinner and start `watchForScript`.
- **Detected:** show a green check "Installed!" and move to Screen 5 after 800 ms.
- **Still not detected 20 s after the user comes back to the tab** (count from the next `visibilitychange` to visible): open the Troubleshooter automatically. The likely causes, in order: Allow User Scripts (or Developer mode) is off, the script is disabled in the Tampermonkey dashboard, the install wasn't confirmed, or Tampermonkey isn't installed.

### Screen 5 - Ready
- Headline: "You're all set." Subtext: "Make sure Chrome is signed in to the Google account whose photos you want to clean."
- Primary button "Open Free Up Space". Build it as `<a href="https://photos.google.com/#gptk-open" target="_blank" rel="noopener">`. In its click handler, call `document.dispatchEvent(new Event('gptk-open-request'))` **synchronously** first, and do not `preventDefault`, so the navigation stays a user gesture and popup blockers don't stop it.
- After the click, change the page text to: "Google Photos is opening in a new tab. The cleanup screen pops up by itself. If it doesn't, click the Prospera icon at the top of Google Photos."
- Small text: "Installed version X" (and "latest Y" if they differ).
- Bookmark tip: "Next time, just open photos.google.com and click the Prospera icon."

### Troubleshooter (a slide-over panel, reachable from every screen through a "Something not working?" link)
A short checklist, each item with a one-line fix:

1. "Are you in Google Chrome on a computer?" (auto-checked from Screen 1)
2. "Is Tampermonkey added?" Includes a link to the store page again.
3. "Is Allow User Scripts on?" Repeats the Screen 3 copy box (version-aware).
4. "Is the tool turned on?" "Click the puzzle icon, then Tampermonkey, then Dashboard. Make sure 'Google Photos Toolkit - Cleanup' is switched on."
5. "Did you click Install?" Includes the install link again.
6. "Signed in to the right Google account?"
7. "Still stuck? Restart Chrome and reload this page."

At the bottom: a **"Text Paul"** button (`sms:{{HELP_PHONE}}?&body=...`) and an **"Email Paul"** button (`mailto:{{HELP_EMAIL}}?subject=Photos%20cleanup%20help&body=...`). Both prefill a diagnostic block: current screen, Chrome version, OS (from `userAgentData.platform`), detected script version or "not detected", the handler string, and the latest version. A "Re-check" button runs `detectScript()` again and jumps to the right screen.

## Behaviour details

- Every screen has exactly one primary (green) button. Secondary actions are text links.
- Don't lose progress on reload. Because state is derived from detection, a reload should land on the right screen by itself.
- `aria-live="polite"` on status lines. Keyboard accessible. Visible focus rings in `--p-green`.
- Wrap all `localStorage` access in try/catch. The page must work without storage (it then asks for the passcode each visit).
- Layout: centered card, max-width 560px, 16px side gutter, no horizontal scroll at 360px width.
- Don't auto-redirect anywhere. Every navigation away from the page is a click the user makes.

## Acceptance tests (the builder runs these and reports results)

Test locally by serving the folder at `http://localhost:<port>/GooglePhotos/`. The script matches localhost on that path.

1. Fresh Chrome profile, no Tampermonkey: passcode, then Screen 2. After adding TM, enabling user scripts and installing, Screen 4 detects the script within 3 s of returning and advances to Screen 5.
2. TM installed but Allow User Scripts off: Screen 4 never detects, and the troubleshooter opens 20 s after returning, with item 3 highlighted.
3. Everything installed: the page lands directly on Screen 5 within about 1.5 s.
4. "Open Free Up Space" opens Google Photos in a new tab and the wizard opens without any further click. Repeat while signed out of Google: after signing in (within 10 minutes) the wizard still opens.
5. Older installed version (edit `gptk.meta.js` locally to a higher version): Screen 5 shows the update notice.
6. Edge, Safari and a phone each get the right stop screen.
7. `?code=<correct>` unlocks and the code disappears from the URL. A wrong code shows the error.
8. `curl -I .../gptk.user.js` returns 200, `text/javascript` and `no-cache`. Visiting it in Chrome with TM installed opens TM's install screen.
9. Lighthouse accessibility >= 95. No em dashes and no purple in the source (grep for the U+2014 character and common purple hexes).

## Placeholders to fill before building

| Placeholder | What |
|---|---|
| `{{PASSCODE_SHA256}}` | Run `printf '%s' 'yourcode' \| shasum -a 256` and paste the hex |
| `{{HELP_PHONE}}` | Paul's mobile in E.164 format, e.g. `+15551234567` |
| `{{HELP_EMAIL}}` | Paul's support email |
| `{{GIF_*}}` | Leave as captioned placeholder boxes until Paul records the 10-15 s clips |

---

## Release procedure (for Paul, not the page builder)

1. In the toolkit repo, bump `version` in `package.json` (e.g. `4.0.0-cleanup.3`).
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm export:site`
3. Copy `dist-site/gptk.user.js` and `dist-site/gptk.meta.js` into the site's `/GooglePhotos/` folder and deploy.
4. Every family install auto-updates within Tampermonkey's update interval (daily by default). The setup page shows "Update available" right away.

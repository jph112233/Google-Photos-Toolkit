# Plan: "Free Up Space" Cleanup Wizard

Status: Implemented, 2026-11-10 (see section 10)
Base: fork of xob0t/Google-Photos-Toolkit v3.3.0 (Tampermonkey userscript)

## 1. Problem and goal

A teenager's Google Photos library uses about 10x the storage of everyone else on the family plan. GPTK can already find the large items, but only through 20+ filters, 7 sources and 14 actions, which is too much for a non-technical teen.

**Goal:** when GPTK opens, show a guided wizard that the teen can run alone. It goes from the biggest, safest wins to the smallest, shows real GB numbers at every step, and lets her pick what to keep from a thumbnail grid before anything moves to trash. The full current UI stays available, unchanged, behind an **Advanced** button.

### Decisions (from interview)

| Topic | Decision |
|---|---|
| Who drives | Teen, alone. Short, friendly copy. Nothing permanent happens inside the wizard. |
| Delete flow | Preview grid inside the wizard. Items she leaves selected go to Trash (recoverable for 60 days). |
| Backup step | None. Trash is the safety net. |
| Platform | Desktop Chrome/Edge. Design for a ~900px+ overlay. A single column below 700px is nice to have. |
| Steps | Storage saver (info) > Big videos > Screenshots and app saves > Near-duplicates > Empty trash |
| Storage saver | Shown first. Explains the numbers and the warning. **Skip** is the primary button. A secondary link opens Google's setting. The wizard never triggers the conversion itself. |
| Layout | Wizard is the default view. An **Advanced** header button swaps in today's full UI. The choice is remembered. |
| Existing "Advanced Settings" | Renamed to **API Tuning**, and lives inside the Advanced view. |
| Big video cutoff | Space-consuming videos over **50 MB**, largest first. |
| Shipping | New **private** GitHub repo under `jph112233`, keeping the upstream git history and the MIT LICENSE. |
| Branding | Prospera logo, palette, and Montserrat across the wizard and the Advanced view (see section 5.4). |

## 2. Research: the simplest way to walk her through it

Patterns from Google's own tools (Google One "Clean up space", the Google Photos "Review and delete" page), Apple's iCloud "Manage storage", and phone cleaner apps like Gemini Photos and Smart Cleaner:

1. **Lead with one number.** "You're using 187 GB. Let's get some back." A storage bar that shrinks as she goes is the motivation loop.
2. **One category per screen**, labeled in her words ("Big videos", "Screenshots"), never in filter words ("Space: consuming, Type: video, Size > 52428800").
3. **Show the payoff before the work.** Each category card shows "~38 GB, 214 items" before she opens it.
4. **Default to "select all", let her un-pick keepers.** Most of what's in "Screenshots" is junk. Making her tick 900 boxes kills the flow. Exception: duplicates, where the best shot in each group is pre-marked **Keep**.
5. **Undo-friendly language.** "Move to Trash (you can get them back for 60 days)" lowers the fear that stops teens from deleting anything.
6. **Celebrate progress.** After each step: "Nice! You freed 38 GB." Running total in the header.
7. **Scan once, up front.** One "Scan my library" with a progress bar, then every step opens instantly from cached results, with no waiting between steps.

Why this order (largest expected savings for a typical teen library first):

| # | Step | Why it's big | Data source in GPTK |
|---|---|---|---|
| 1 | Storage saver (info only) | Re-compressing Original-quality items often saves 30-60% across the board | `getBatchMediaInfo` gives `isOriginalQuality` and `size` |
| 2 | Big videos (>50 MB) | Videos are usually 50-80% of a teen's bytes. 4K/60fps clips and screen recordings run 200 MB to 2 GB each | Library items with `duration`, plus `size`/`takesUpSpace` from batch info |
| 3 | Screenshots and app saves | Thousands of small files add up. Saved Snapchat/Instagram/TikTok/WhatsApp media is often duplicated | GP search `"screenshots"` plus filename regex |
| 4 | Near-duplicate selfies and bursts | Ten nearly identical selfies per moment | Existing dHash similarity, limited to time windows |
| 5 | Empty the trash | Trashed items **still count** against storage for 60 days. GPTK's API cannot empty the trash | `getAllTrashItems` plus batch info for the GB total, then a link to the Trash page |

Only items that are **owned** and have `takesUpSpace === true` are counted or offered. Partner-shared or shared-album items she doesn't own never appear.

## 3. UX flow

```
+-------------------------------------------------------------+
| [PROSPERA logo]  Free Up Space          [Advanced]  [x]      |
| [##########################------]  187 GB used  (-0 GB)    |
+-------------------------------------------------------------+
| (o) Scan  ( ) Saver  ( ) Videos  ( ) Shots  ( ) Dupes  ( ) Trash |
|                                                             |
|  <step content>                                             |
|                                                             |
|                                   [Back]   [Primary CTA]    |
+-------------------------------------------------------------+
| Powered by Prospera  •  www.Prosperahq.io          v4.0.0    |
+-------------------------------------------------------------+
```

The header carries the Prospera logo on the left. It also holds a storage bar from `getStorageQuota()` (`usedByGPhotos` / `totalAvailable`) and a "freed so far" counter. A stepper shows where she is. Each step can be skipped.

### Step 0: Welcome / Scan
- Copy: "Let's find what's eating your storage. This takes a few minutes and doesn't change anything."
- CTA **Scan my library**, then a progress bar with phases: reading library > getting sizes > finding screenshots > done.
- Result screen: one card per step with its GB and item count, sorted by size. CTA **Start with the biggest win**.
- Has a **Stop** button (reuses `core.isProcessRunning`).

### Step 1: Storage saver (information only)
- "41,200 of your photos and videos are saved in **Original quality** (163 GB). Switching them to **Storage saver** could free about **60-90 GB**. They'll still look great on a phone, but you **can't undo** this."
- Show a range rather than a single number, since Google's recompression ratio varies.
- Buttons: **Skip for now** (primary), then the link "Open Google's Recover storage setting" (`https://photos.google.com/settings`, opens in a new tab) with a 3-line how-to.
- Skipping goes to Step 2. The wizard never calls anything that converts quality.

### Step 2: Big videos
- Filter: owned, `takesUpSpace`, `duration > 0`, `size > 50 MB`, sorted by size descending.
- Preview grid (see section 4). All selected by default. Sticky footer: "**Selected: 128 videos, 41.3 GB**" and **Move to Trash**.
- Optional chip filters above the grid: "Screen recordings" (filename `RPReplay|ScreenRecord|Screen_Recording|screen-?record`) and "Longer than 1 min".

### Step 3: Screenshots and saved app images
- Union of: GP search `screenshots` results (via `getAllSearchItems`), plus filename matches:
  - `Screenshot|Screen Shot|SCR-\d`
  - `Snapchat-\d+|IMG-\d{8}-WA\d+|VID-\d{8}-WA\d+` (WhatsApp)
  - `^received_|FB_IMG_|Instagram|TikTok|^\d{19}\.mp4$` (Messenger, Facebook, IG, TikTok exports)
- De-duplicate by `mediaKey`, owned and space-consuming only.
- Chips: "Screenshots", "Snapchat", "WhatsApp", "Other apps". All selected by default.

### Step 4: Near-duplicates and bursts
- Images only (no videos), owned, space-consuming.
- **Performance change vs. today's similarity filter:** bucket items into time windows (photos taken within 10 minutes of each other) and hash/compare only inside each bucket. The current filter is O(n^2) across the whole set, which is too slow for 40k+ photos.
- Reuses `generateImageHash`/`hammingDistance` from `filters.ts` (export them), threshold 0.90, 16px thumbs.
- UI: one row per group. The highest-resolution / largest item is pre-marked **Keep** (green ring). Others are pre-selected for trash. Clicking flips Keep/Trash. Footer: "Selected: 640 photos in 112 groups, 3.1 GB".

### Step 5: Empty the trash
- Shows: "Your Trash has **2,340 items (52 GB)** that still count against your storage." The count includes what she just trashed.
- GPTK can't empty the trash via the API, so: **Open Trash** (opens `https://photos.google.com/trash` in a new tab) plus "Click **Empty trash** in the top right."
- **Re-check** button refreshes the trash total and the storage bar.
- Done screen: "You freed **X GB**" (sum of what she trashed, plus trash emptied if the re-check shows it).

## 4. Shared preview grid component

One reusable component for steps 2-4:

- Thumbnails: `item.thumb + '=w180-h180-c'`, lazy-loaded with `IntersectionObserver`, 60 per page with infinite scroll.
- Each tile: checkbox state (selected = will be trashed, dim overlay + red tick), size badge ("312 MB"), duration badge for videos.
- Click toggles selection. A small "open" icon opens `https://photos.google.com/photo/{mediaKey}` in a new tab so she can play a video before deciding.
- Toolbar: **Select all**, **Select none**, sort (Size / Date).
- Sticky footer: live count and GB of the selection, plus **Move to Trash** (disabled when 0).
- Confirm modal: "Move 128 items (41.3 GB) to Trash? You can restore them from Trash for 60 days." > **Move to Trash** / Cancel.
- Calls the existing `apiUtils.moveToTrash(items)`, with progress, then removes trashed items from the cached scan and adds the bytes to "freed so far".

## 5. Technical design

### 5.1 New and changed files

```
src/
  cleanup/
    scan.ts            NEW  one-pass scan > ScanResult (cached in memory)
    categories.ts      NEW  pure fns: bigVideos(), screenshots(), originalQualityStats()
    duplicates.ts      NEW  time-bucketed similarity grouping (uses filters.ts hash fns)
    format.ts          NEW  bytes > "41.3 GB", ms > "1:42"
  ui/
    wizard/
      wizard.ts        NEW  step state machine, render, view toggle
      preview-grid.ts  NEW  reusable grid component (section 4)
      steps/*.ts       NEW  one file per step (scan, saver, videos, screenshots, dupes, trash)
    markup/
      wizard-template.html  NEW
      style.css             EDIT  add wizard styles (scoped under #gptk-wizard)
      gptk-main-template.html EDIT  add Advanced/Wizard toggle in header; rename "Advanced Settings" > "API Tuning"
    logic/
      insert-ui.ts     EDIT  insert wizard template; showMainMenu() opens the remembered view
      gptk-ui-init.ts  EDIT  call initWizard()
  filters.ts           EDIT  export generateImageHash, hammingDistance, fetchImageBlobs
  types/global.d.ts    EDIT  declare module '*.png'
build/
  datauri-plugin.mjs   NEW  inline PNGs as base64 data URIs
media/brand/           ADDED  prospera-logo-light.png, prospera-logo-dark.png, prospera-mark.png
src/ui/markup/gptk-button.html  EDIT  Prospera mark icon
tests/
  categories.test.ts   NEW
  duplicates.test.ts   NEW  bucketing + grouping on fixture hashes
  format.test.ts       NEW
```

The existing filters, sources, actions, `gptk-core.ts` and the `gptkApi` global stay **unchanged** in behavior.

### 5.2 Scan pipeline (`scan.ts`)

```ts
interface ScanResult {
  quota: StorageQuota;
  items: MediaItem[];           // owned library items, extended with size/takesUpSpace/isOriginalQuality
  screenshotKeys: Set<string>;  // from GP "screenshots" search
  trash: { count: number; bytes: number };
  scannedAt: number;
}
```

1. `api.getStorageQuota()`
2. `core.getLibraryItemsByTakenDate({})`: full library (same path as the Library source). Log progress to the wizard's progress bar, not the log area.
3. `core.extendMediaItemsWithMediaInfo(items)`: sizes in chunks of `infoSize` (5000).
4. `apiUtils.getAllSearchItems('screenshots')` > key set.
5. `apiUtils.getAllTrashItems()` > extend > sum.
6. Keep in memory only. Optionally write a size-only summary to `localStorage` under `gptk-wizard-summary` so the results screen survives a reload (no thumbnails/keys stored).

Needs `core.isProcessRunning = true` during the scan so the existing Stop works. Show an ETA based on the item count after step 2.

### 5.3 View toggle

- `localStorage['gptk-view'] = 'wizard' | 'advanced'`, default `'wizard'`.
- The header button reads **Advanced** in wizard view and **Back to Free Up Space** in advanced view.
- Both views live in the same `#gptk` container. The toggle swaps `display` on `.window-body` vs. `#gptk-wizard`. The old header step badges ("1 Source > 2 Filter > 3 Action") show only in advanced view.

### 5.4 Prospera branding and styling

Source of truth: `Prospera/Admin/Creative/BrandGuide Rev1.pdf`. Logo files are already copied into the repo:

| File | Use |
|---|---|
| `media/brand/prospera-logo-light.png` (400x74, transparent) | Header logo on light backgrounds |
| `media/brand/prospera-logo-dark.png` (400x74, transparent, white wordmark) | Header logo in dark mode |
| `media/brand/prospera-mark.png` (32x32) | Icon on the GPTK launch button in the Google Photos toolbar, and `userScript.icon` |

**Logo placement**
- **Wizard and Advanced headers:** horizontal logo top-left, rendered at **200px wide** (the brand guide's minimum), 37px tall. It replaces the wrench icon + "GPTK" text. The title "Free Up Space" (wizard) or "Advanced" sits to its right in Montserrat Semibold.
- **Footer (both views):** a thin `#B1B2C9` rule, then "Powered by Prospera  •  www.Prosperahq.io" on the left (the link opens https://www.prosperahq.io in a new tab) and the version on the right.
- **Launch button:** swap the GPTK button icon in `gptk-button.html` for the Prospera mark.
- Never stretch or recolor the logo. Use the dark-BG variant whenever the panel background is dark.

**Embedding the images:** a userscript is one file, so the PNGs are inlined as base64 data URIs at build time (~50 KB total). Add a tiny `dataUri()` plugin in `build/` next to `strings-plugin.mjs` (read the file, `export default "data:image/png;base64,..."`), registered in `rollup.config.mjs` for `**/*.png`, plus a `declare module '*.png'` in `src/types/global.d.ts`. `insert-ui.ts` sets `img.src` from the import. This avoids fetching from GitHub, which would fail anyway for a private repo.

**Palette** (CSS custom properties on `#gptk`, so both views share them):

| Token | Value | Use |
|---|---|---|
| `--p-dark` | `#09122B` | Text, header background in dark mode |
| `--p-navy` | `#1D2B52` | Secondary text, stepper lines, Advanced view section labels |
| `--p-green` | `#14B87C` | Primary buttons, selected step, storage bar fill, **Keep** ring |
| `--p-green-2` | `#6CC852` | Hover states, "freed" counter |
| `--p-gradient` | `linear-gradient(135deg, #14B87C, #D4DC1E)` | Storage bar fill, Done-screen celebration, progress bar |
| `--p-faded` | `#B1B2C9` | Borders, dividers, disabled states |
| `--p-danger` | `#D93025` | Trash buttons and selected-for-trash tile overlay only (functional, not brand) |

**No purple anywhere.** `--p-faded` is a grey-blue. Keep it for borders only, never as an accent fill.

**Typography:** Montserrat (Regular 400, Semibold 600, Bold 700) loaded from Google Fonts via a `<link>` injected by `insert-ui.ts`, with fallback to the existing system font stack if photos.google.com's CSP blocks it. Scoped to `#gptk` so Google Photos' own UI is untouched.

**Other:**
- White cards, 12px radius, soft shadow. Dark mode keeps the existing `prefers-color-scheme` handling: panels use `--p-dark`, cards use `--p-navy`, and the dark logo is swapped in.
- Large tap targets (44px), max ~12 words per instruction line.
- The Advanced view gets the same header/footer/palette, but its layout stays as is.

### 5.5 Safety rules (non-negotiable)

- The only destructive call the wizard makes is `moveToTrash`. It never calls lock, archive, quality conversion, or anything permanent.
- Always confirm with count + GB before trashing.
- Never offer items with `isOwned === false` or `takesUpSpace !== true`.
- Favorites are **excluded by default** from steps 2-4 (filter `isFavorite !== true`), with a small "Include favorites" toggle.
- Items in any **shared album** she owns are excluded by default (reuse `excludeSharedItems` logic), so she never removes photos that friends see.

## 6. Repo and release

1. Create the private repo: `gh repo create jph112233/<name> --private`, then `git remote add new ...` and `git push new main` (full history preserved, LICENSE kept, README credits xob0t).
2. Update `package.json` `userScript.namespace`/`homepage`/`downloadURL`/`icon` to the new repo. **Note:** a private repo's release asset URL needs auth, so Tampermonkey's auto-update and one-click install **won't work**. Install by building locally (`pnpm build`) and dragging `google_photos_toolkit.user.js` into the Tampermonkey dashboard. Either remove `downloadURL`/`updateURL`, or point them at a private Gist if auto-update matters later.
3. Bump the version to `4.0.0-cleanup.1` and give the script a distinct `@name` (e.g. "Google Photos Toolkit - Cleanup") so it doesn't collide with an upstream install. Disable the upstream script if both are installed.
4. Keep `upstream` as a remote to pull fixes: `git fetch upstream && git merge upstream/main`.

## 7. Implementation phases

| Phase | Scope | Done when |
|---|---|---|
| 0 | New private repo, metadata/name changes, local build installs in Tampermonkey | Script loads on photos.google.com under the new name |
| 1 | Prospera branding (data-URI plugin, logo header/footer, palette tokens, Montserrat), view toggle + wizard shell (header bar, stepper, empty steps), rename to API Tuning | Advanced view works as today with Prospera branding. Wizard opens by default. |
| 2 | `scan.ts`, `categories.ts`, `format.ts` + tests; Step 0 results cards | Real GB numbers per category on her library |
| 3 | Preview grid + Step 2 (Big videos) + trash flow | Can trash selected videos; storage bar and "freed" update |
| 4 | Steps 1 (Storage saver info) and 3 (Screenshots) | Both use real data |
| 5 | `duplicates.ts` time-bucketed grouping + Step 4 | 40k-photo library groups in under ~5 min without freezing the tab |
| 6 | Step 5 (Trash) + Done screen, polish, copy pass, dark mode | End-to-end run on the real account |
| 7 | `pnpm lint && pnpm typecheck && pnpm test`, manual QA checklist (section 8) | All green |

## 8. QA checklist

- [x] Advanced view: Library + Space/Type/Size filter returns results (read-only check). New Album skipped by owner decision (album code unchanged; albums can't be deleted via the API).
- [x] View choice persists across reloads.
- [x] Scan: Stop mid-way leaves the UI usable. Re-scan works.
- [x] Not-owned, shared-album, favorite, and non-space-consuming items never appear in grids (by default). Unit-tested; live: 11 wizard videos vs 14 in Advanced.
- [x] Trash confirm shows the correct count/GB. Live run: 1 screenshot (990 KB) moved to Trash through the wizard, appeared in Google Photos Trash (18 to 19), then restored (back to 18, back in library).
- [x] Freed counter matches the sum of trashed `size` (990 KB shown in flash, storage bar and Done screen).
- [x] Duplicates: Keep item is never trashed (last kept photo can't be flipped). Groups look right on burst sequences. 3,619 candidates in ~40 s.
- [x] Trash step totals update after emptying the trash in Google Photos and pressing Re-check (live: 18 items emptied with owner approval; Re-check showed "Your Trash is empty", Done showed "Trash emptied!").
- [x] No console errors from the wizard. The tab stays responsive during the scan.
- [x] No em dashes or purple in copy/CSS.
- [x] Prospera logo is crisp at 200px wide in light and dark (dark tokens verified visually), never stretched. Footer link opens prosperahq.io.
- [x] Montserrat loads on photos.google.com, scoped to `#gptk`.
- [x] The built `.user.js` has the logos and the `@icon` inlined as data URIs.

## 9. Risks and open items

- **Undocumented API drift:** Google can change RPC payloads at any time (true of all GPTK). Parser fixtures in `tests/fixtures/parser` cover the calls we rely on.
- **`isOriginalQuality` accuracy:** the "could save" range for Storage saver is an estimate. The copy says "about".
- **Search term locale:** `"screenshots"` works in English UI. Filename regex is the fallback if search returns nothing.
- **Very large libraries (100k+):** memory for item arrays is fine (~100 MB worst case), but the duplicate step may need a "scan one year at a time" option.
- **Private repo install friction:** see section 6.2.

## 10. Implementation notes (2026-11-10)

Deviations from the plan, found while testing against a real library:

- **Trash size:** Google returns no media info for trashed items, so Trash bytes are unknown. The Trash step shows the item count, plus the exact size of items the wizard trashed this session ("at least X"). Emptying is detected by the count dropping on Re-check.
- **Screenshot search:** the `screenshots` search also returns camera photos (HEIC/JPG). A search hit only counts when the file is a PNG; filename patterns still match any extension.
- **Shared-album check:** accounts can have hundreds of tiny shared links, so they are fetched 8 at a time with "X of Y" progress.
- **Trash call:** the wizard calls `api.moveItemsToTrash` per chunk itself (same RPC as `apiUtils.moveToTrash`) so it knows exactly which items succeeded for the freed counter.
- **Wizard styles** live in `src/ui/markup/wizard.css` (loaded with `style.css`) rather than inside `style.css`.
- **Look-alikes** fetch 16px thumbs (48 at a time) only for photos that share a 10-minute bucket (capped at 150 per bucket). Measured: 3,600 cold thumbs in 12.9 s and about 5.5 s of hashing per 3,600, so about 3.5 min for 40k photos.
- **Repo:** `jph112233/Google-Photos-Cleanup` (private). `origin` is the public fork; the private repo is the `private` remote.
- **Trash does not count against storage:** Google's own Empty trash dialog says "Items in trash don't count towards your Google Account storage", and the Trash page says items are deleted after 30 days (not 60). The plan's step 5 premise was wrong, so the step is now "Check the trash" (emptying is optional) and all copy says 30 days.
- **40k timing:** no 40k library was available. Measured worst case on the test account: all 16,203 photos (cold 16px thumb fetch at 48 concurrent, decode and downscale) in 74.6 s, about 217 photos/s; the wizard's hash and grouping step runs at about 650 photos/s. A 40k library where every photo is a candidate projects to about 4 min, under the 5 min target. Real libraries only hash photos that share a 10-minute bucket, so they are faster. Owner accepted this in place of a 40k run.

## 11. Large-library redesign (2026-11-10)

Goal: work on a 400 GB library (likely 100k+ items) without a scan that takes ages or never finishes.

**What the old first scan cost** (measured on a 23 GB, 16,942-item library): listing the whole library took 20 s as 41 sequential pages, sizes about 8 s, and the shared-album check about 21 s (204 links). Listing grows linearly with library size, so a 100k-item library would spend minutes before showing anything.

**Quick wins first.** Google's own "Manage storage" page (photos.google.com/quotamanagement) has server-computed review lists, served by rpc `omQMf` with payload `[null, null, category]` (next page: `[null, null, category, null, null, token]`, token at response index 2). Items use the library item shape, and field `318563170` carries `[takesUpSpace, bytes, quality]`, so sizes come with the list.

| Category | Id | On the test library |
|---|---|---|
| Large photos & videos (roughly biggest first) | 1 | 2,089 items, 15.5 GB of 23 GB, 5 pages in 2.2 s, all 14 videos over 50 MB |
| Blurry photos | 2 | 440 items |
| Other apps | 4 | 23 items |
| Screenshots | 5 | 127 items |

**New pipeline:**
1. **Quick scan** (`src/cleanup/scan.ts`): quota, then the four Google lists plus the "screenshots" search in parallel, then batch info only for those items (file names), then the Trash count. Cost grows with the number of quick wins, not with library size. Measured: **4.2 s** end to end (the old full scan took about 2 min) and it found the same 11 big videos (981 MB).
2. **Shared-album check** runs in the background after the quick scan. Results show immediately; Move to Trash stays locked, with a progress notice, until it finishes (about 20 s here). It doesn't use `isProcessRunning`, so the person can browse meanwhile.
3. **Look-alikes stream** through the timeline newest first, one page at a time, with the next page prefetched. Only photos taken within 10 minutes of another photo get batch info and thumbnails; the oldest run of each page carries over to the next. Groups appear as they are found, Stop keeps them, and **Keep looking** resumes from a saved cursor. Measured: the whole 16,942-photo library in 25-30 s, with the first groups within seconds; stop then resume gives exactly the same groups as one uninterrupted run (254 groups, 318 photos).
4. **New Blurry photos step**, from Google's list.
5. **Storage saver** now reads the quality flag on the Large list, so its numbers are a floor ("at least"): those items hold most of the bytes.

**Projected for her 400 GB library:** quick scan about 15-30 s (scales with the Large list, about 0.45 s per 500 items); look-alikes about 0.15-0.2 s per 100 photos, so about 3 min per 100k photos, with results usable from the first few seconds and resumable at any point.

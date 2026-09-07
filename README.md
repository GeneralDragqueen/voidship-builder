# Voidship Builder

An interactive ship builder for the Rogue Trader tabletop RPG (Fantasy Flight Games, Core Rulebook chapter VIII). One self-contained HTML file: open `index.html` in any modern browser, or host it on any static web server.

## Features

- Every hull and component from the Core Rulebook (pp. 194–208) with the official Errata applied: Power, Space and Ship Point costs per hull class, weapon stats, effects and rules text.
- Per-category pickers that show what fits your hull and why the rest doesn't, with a live preview of what any change does to budgets and stats before you install it.
- Complications (Machine Spirit Oddities and Past Histories) applied to the sheet; Archeotech and Xeno-tech gated by them or by a GM override.
- Ship Point adjustments ledger for house rules, with causes.
- Saved builds, comparison of up to three builds, share codes and links.
- Export: Discord-sized text, Markdown, and a print-ready A4 dossier (Print → Save as PDF).
- Backup and restore of all builds as a code or JSON file.

Press `?` in the app for the help sheet, including keyboard shortcuts.

## Saving

Builds autosave in the browser, tied to the page's address. A downloaded copy, a hosted copy and each device keep separate lists. Use *Copy backup code* / *Download backup* and *Restore backup…* in the Builds panel to move them.

Switching ships saves outgoing edits and clears Undo history. Incomplete imports remain editable with warnings. If saved data needs repair, the app keeps an original recovery copy and offers **Download original data**. If that copy cannot be stored, recovery runs in the current tab without overwriting the original storage; download the original data and a backup before closing.

## Development

There is no build step. `index.html?selftest` runs the built-in rule assertions and reports them in the console and a toast.

The browser regression suite runs the built-in assertions and exercises saving, Undo, imports, recovery, exports, comparisons, and responsive layout in Chromium and WebKit. It uses a fresh browser context for each test and controls time in autosave tests.

With Node.js 24 or later:

```sh
npm ci
npx playwright install chromium webkit
npm test
```

On Linux, install browser system dependencies with `npx playwright install --with-deps chromium webkit`. View the HTML results with `npm run test:report`.

`npm test` copies only the public files into `_site/` and tests that artifact under `/voidship-builder/`, matching the Pages URL prefix. To run the same regressions against an older extracted site, use `SITE_ROOT=/absolute/path/to/old-site npx playwright test`; the test server never modifies the selected site. Test reports, browser traces, and screenshots are kept outside the publishable artifact.

`ledger/` holds a companion reference sheet (LaTeX source and PDF) of the same component tables.

## Publication

The **Test and publish** workflow tests pull requests and changes to `main`. Only a passing `main` run can package and deploy the exact site files tested by that run. A manual workflow run also requires `main` to publish. Reports and failure screenshots are separate artifacts and are never published with the site.

Before merging the first workflow change, review the green pull-request checks and change **Settings → Pages → Build and deployment → Source** from branch publishing to **GitHub Actions**. This prevents the old branch publisher from bypassing the regression checks. Keep the existing `github-pages` environment; no automatic merge is configured. See the official [Playwright CI instructions](https://playwright.dev/docs/ci) and [GitHub Pages custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

After merge, verify that **Test and publish** succeeded, the deployed HTML matches that run's commit, HTTP redirects to HTTPS, and the [ledger PDF](https://generaldragqueen.github.io/voidship-builder/ledger/voidship-ledger.pdf) opens. These checks do not attest rulebook accuracy, physical-phone behavior, or final PDF pagination.

## Legal

This is an unofficial, non-commercial fan tool. It is not affiliated with, endorsed by or licensed by Games Workshop Limited or Fantasy Flight Games. Warhammer 40,000, Rogue Trader and associated names are trademarks of Games Workshop Limited, used only to identify the game the tool supports. The tool contains component statistics and short rules summaries in its own words; it contains no rulebook text, artwork or scans. Rights holders may request removal at any time.

The code in this repository is released under the MIT License (see `LICENSE`). Game statistics and names remain the property of their respective owners.

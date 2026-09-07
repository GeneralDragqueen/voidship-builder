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

## Development

There is no build step. `index.html?selftest` runs the built-in rule assertions and reports them in the console and a toast.

`ledger/` holds a companion reference sheet (LaTeX source and PDF) of the same component tables.

## Legal

This is an unofficial, non-commercial fan tool. It is not affiliated with, endorsed by or licensed by Games Workshop Limited or Fantasy Flight Games. Warhammer 40,000, Rogue Trader and associated names are trademarks of Games Workshop Limited, used only to identify the game the tool supports. The tool contains component statistics and short rules summaries in its own words; it contains no rulebook text, artwork or scans. Rights holders may request removal at any time.

The code in this repository is released under the MIT License (see `LICENSE`). Game statistics and names remain the property of their respective owners.

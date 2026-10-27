# BEEP Kenshi Mod Manager

**Beep Enhances Every Playthrough**

> **Enhanced Edition** — a fork of [BEEP Kenshi Mod Manager](https://github.com/Derthi/BEEP-Kenshi-Mod-Manager) by Derthi (MIT License),
> modified by skybogli: convenience features (mod list viewer, list share strings, selection and panel tweaks)
> and a built-in translation / patch tool. Original work © 2026 Derthi, modifications © 2026 skybogli — see [LICENSE](LICENSE).
>
> This is an **unofficial** fork, not affiliated with or supported by Derthi. Please report problems with this edition
> [here](https://github.com/skybogli/BEEP-Kenshi-Mod-Manager/issues), not to the original project.

A Electron-based mod load order manager for [Kenshi](https://store.steampowered.com/app/233860/Kenshi/). Works with both **Steam** and **GOG** installations. Organize your mods into categories, detect conflicts at every level, visualize them on the world map, and get AI-assisted sorting suggestions.

Original project: [GitHub](https://github.com/Derthi/BEEP-Kenshi-Mod-Manager) · [Steam Workshop Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3704937622) · [Discord](https://discord.gg/QvFTmRKHSz) (for the original version)

## Enhanced Edition features

### Mod list viewer (Ctrl+Shift+O)
- Open an exported mod list in a **separate window** (same size as the main window, up to 4 at once) without touching your current setup.
- **View mode** shows the list as it is; **Edit mode** lets you turn mods on/off, move them, and add, rename or delete categories.
- **Addable owned mods** panel (left, folded by default): mods you have that the list doesn't, ready to drag in.
- Missing mods can be subscribed to on the Workshop; the list can be **imported into the main screen** or exported again (file or string, saved as `<name>_사본 01` etc.).
- Ctrl+M / Ctrl+Shift+M / F11 for the window; unsaved changes are asked about on close.

### Mod list share strings
- **Advanced export → String**: the whole list (categories, order, on/off) as one short `BEEP1:` string — copy it to the clipboard or save it as txt.
- **Import ▾ → Import from string… (Ctrl+I)**: paste a string or open a txt that holds one, then import it into the main screen or open it in the mod list viewer.

### Translation / patch tool (KMT)
- A built-in port of KMT, a Kenshi FCS (`.mod`) translation tool: parses `.mod` records and translates the text fields.
- Glossary first (`source = translation`; a source containing `=` is written `source =|= translation`), the mod's own `main.po` reused, the rest by Google Translate (with rate-limit waits and a cache).
- Save as a **separate patch mod** (original untouched), **edit the original** (backed up), or make a **patch file** of chosen fields.
- **Extract** strings that need translation into a glossary file (dialogue grouped by PACKAGE > DIALOGUE > LINE) to translate elsewhere.
- **Review window**: check and edit translations line by line, add them to the glossary; recent files on the left, older ones grouped by mod, search.
- Target language follows the app language and can be changed in its settings; Korean / English UI.

### Editing tweaks
- Explorer-style Shift / Ctrl selection; selections in other categories are kept.
- Fold buttons on the panel resize bars; moving a category with the keyboard scrolls it into view.
- Import ▾ menu: Import list (Ctrl+O), Import from string (Ctrl+I), Mod list viewer (Ctrl+Shift+O).

## Features

### Mod Sorting
- **Category-based sorting** — Organize mods into customizable categories (UI, Animations, Races, Weapons, etc.) displayed as columns. Load order reads left-to-right, top-to-bottom.
- **Drag and drop** — Reorder mods within and between categories. Drag column headers to reorder entire categories.
- **Multi-select** — Ctrl+click to toggle, Shift+click for range select. Right-click to move all selected mods to a category at once.
- **Group drag** — Drag multiple selected mods together with a visual preview of all mod names.
- **Pin Uncategorized** — Pin uncategorized mods to a resizable side panel for easy sorting.
- **Horizontal & vertical layouts** — Toggle between column view and stacked list view.
- **Preserved load order** — First launch respects your existing mods.cfg load order instead of alphabetical.

### Categories
- **Click to rename** — Click category names directly to rename them.
- **Inline controls** — Arrow buttons to reorder, color picker, collapse/expand, and delete on every header.
- **Position picker** — Choose where new categories appear when creating them.
- **Reset Categories** — Restore the default category set.

### Dependency Detection
- **Missing dependency warnings** — Mods with uninstalled dependencies are highlighted in red.
- **Inactive dependency detection** — Dependencies that exist but are disabled are flagged.
- **Load order validation** — Dependencies that load after the mods that need them are caught.
- **Hover for details** — Hover over red-highlighted mods to see the specific dependency issue.
- **Status bar alerts** — Summary of all dependency problems shown in the status bar, updated in real-time.
- **Detail panel** — Missing dependencies shown in red in the Dependencies/References rows.

### Conflict Detection
- **Deep conflict detection** — Parses .mod binary files, leveldata, and interior data to detect when multiple mods modify the same game data.
- **Actual values shown** — Expand any conflicting property to see what each mod sets, with the winning value highlighted in green.
- **Same-value filtering** — Conflicts where all mods set identical values are hidden (no false positives from FCS saving unchanged properties).
- **Asset override detection** — Scans mod directories for file-level overrides (meshes, textures, sounds) where one mod's files replace another's.
- **Level data parsing** — Deep-parses .level files to detect exterior (world placement) and interior (building layout) conflicts at the item/property level.
- **Three-way conflict indicators** — Green (winning), red (overridden), and yellow (both overridden by a third mod).
- **Focus mode** — Dims all non-conflicting mods to 15% opacity for easy identification.

### Interactive Conflict Map
- **4K Kenshi world map** — Converted from the game's GUI map texture.
- **Conflict zone overlays** — Red squares highlight zones with conflicts, click to see details.
- **Zoom and pan** — Scroll wheel to zoom toward cursor, click and drag to pan.
- **Exterior/Interior toggle** — Switch between viewing world placement and building interior conflicts.
- **Sidebar grouped by winning mod** — Collapsible mod groups with zone sub-items showing conflicting mods and properties.
- **Click-to-focus** — Click a zone on the map to scroll the sidebar to details. Click zone filenames in the conflicts tab to open the map.

### Import & Export
- **Export List** — Save your full setup (categories, load order, active/inactive state) to a shareable text file.
- **Import List (BEEP format)** — Restore categories, ordering, and active state from a BEEP export file.
- **Import List (generic)** — Import a plain list of .mod filenames to reorder uncategorized mods.
- **Mod Packs** — Save and load complete mod configurations. Great for switching between playthroughs or backing up before AI sort.

### AI-Assisted Sorting
- **AI Sort Export** — Fetches Steam Workshop descriptions and builds a text file for AI chatbots.
- **AI Sort Import** — Paste the AI's sorted response to apply the new category order.
- No data is sent automatically — you are the middleman. The app only contacts Steam's public API.
- Supports Claude (recommended for large lists) and ChatGPT.

### Other Features
- **Steam & GOG support** — Auto-detects Kenshi from Steam libraries, GOG Galaxy registry, and common install paths on all drives.
- **Folder Setup** — Easily change or clear game paths from the toolbar or welcome screen.
- **Kenshi & Dark themes** — Toggle between a warm Kenshi-inspired theme with grain texture and a dark grey theme.
- **Built-in tutorial** — Full usage guide accessible from the Tutorial tab.
- **Mod preview images** — Displays Steam Workshop thumbnails in the detail panel.
- **Integrated browsing** — View mod Steam/Nexus pages, the Kenshi modding guide, and the Steam Workshop directly in the app.
- **Auto-update** — Checks this edition's releases on launch (Help → Check for Updates on Start turns it off; Help → Check for Updates… checks now) and installs a new version in place.
- **Launch game** — Save your load order and launch Kenshi directly from the app.
- **GitHub link** — Quick access to the project repository from the toolbar.

### Load order panel & editing (1.2.14)
- **Actual load order panel** on the left (details moved to the right): the mods that are on, in the order Kenshi loads them, coloured by category. Drag there to put a mod at a position — it joins the category it lands in.
- **Unsaved changes**: the Save button shows `*` while the load order differs from mods.cfg; closing asks to save, and Refresh goes back to the last saved state.
- **Keyboard editing**: Ctrl+A select all, Ctrl+X / Ctrl+V move & paste, Shift+↑/↓ one step, Shift+←/→ previous/next category, Ctrl+Shift+↑/↓ top/bottom, Ctrl+Shift+←/→ first/last category, Ctrl+Shift+Alt+←/→ move the category itself (Home / End: to the front / back), F8 / Shift+F8 next / previous mod with a problem, Ctrl+F search, Ctrl+S save. In the File, Edit and Move menus. Also in the Edit menu.
- **Sort rules**: a default rule and per-category rules (direction, character priority, mods that are on first), by each mod's original name, with optional auto sort. A sort that changes the load order asks first.
- **Category headers**: ✎ rename, ⇅ sort, drag the header to reorder, right-click menu with sort and move entries.
- **Busy overlay** while checking conflicts or fetching Steam descriptions; **Alt+H** opens the tutorial, **Alt+M** the Workshop tab.
- Build without Node: `python tools/build.py` (copies the v1.2.13 runtime, packs this source, and saves a source copy in `Source Code\BEEP-Kenshi-Mod-Manager-v<version>`).

### 📌 pins, layouts & settings (1.2.15)
- **Actual load order with 📌 pins**: loading keeps mods.cfg exactly and pins only the mods that differ from the categories. Dragging in the load order panel / Send to # / Shift+arrows there place a mod and pin it (its category stays). Right-click: *Pin at current position* / *Unpin*; ⟲ above the panel unpins all.
- **Uncategorized** is a normal column, by default on the left, and can be moved like the others.
- **Moving a category** (◀ ▶, header drag, Ctrl+Shift+Alt+←/→) moves its mods in the load order; if some are pinned, you choose to move them along or keep them in place. Sorting asks whether to apply to the actual order or sort the category only.
- **⚙ Settings** (far right, Ctrl+,): language, Kenshi folders, map zoom / column scroll speed, **category width** (default 300px, wider than before), and the **category layout**: by Workshop tags, BEEP defaults or your own list (move / remove / add), auto classify by Steam Workshop tags (leftmost category first), keep the current load order, and Reset categories. Default category names follow the UI language.

### Settings & counts (1.2.16)
- Undo / Redo buttons show how many steps are left.
- ⚙ Settings: Kenshi folders (auto-detect, browse, clear) right in the dialog; separate up/down and left/right category scroll speed (up to 4×); changes are kept with **Save**, and closing with unsaved changes asks first.
- "Uncategorized" and the Mods Folder / LinkMods / UnlinkMods buttons follow the UI language (Korean added).

### Detail panel & same-name mods (1.2.17–1.2.18)
- Detail panel: **Steam page**, **Install folder** and **Workshop folder** buttons, plus the mod's Workshop tags.
- Copies of a `.mod` with the same file name (e.g. a local copy and Workshop subscriptions) are separate entries: each can be placed, moved, sorted and pinned on its own. mods.cfg only stores names, so only one copy of a name can be on — turning one on turns the others off, and which one is remembered. The card shows `×2`; the detail panel lists the other copies.
- Export writes `name|active` and, for a second copy, `|source:folder` (older versions ignore it); import puts each copy back.
- Alt+M / Help → Steam Workshop opens the Workshop in the browser.

## Installation

### From release (recommended)

1. Download the latest release from the [Releases](https://github.com/skybogli/BEEP-Kenshi-Mod-Manager/releases) page.
2. Extract anywhere.
3. Run `BEEP Kenshi Mod Manager.exe`.

Works with both **Steam** and **GOG** versions of Kenshi. Windows 64-bit only.
The app is not code-signed, so Windows SmartScreen may warn on first launch: **More info → Run anyway**.

### From source

```bash
git clone https://github.com/skybogli/BEEP-Kenshi-Mod-Manager.git
cd BEEP-Kenshi-Mod-Manager
npm install
npm start
```

### Build

```bash
python tools/build.py
```

Needs Python 3 only (no Node). It copies the Electron runtime from the newest `BEEP-Kenshi-Mod-Manager-v*-win64` folder next to `Source Code`,
packs this source into `resources/app.asar`, and writes `BEEP-Kenshi-Mod-Manager-v<version>-win64` (plus a source copy in `Source Code`).
Bump `version` in `package.json` first — an existing output folder is never overwritten.

## How it works

- Mods are discovered from `{GamePath}/Mods/` (local) and Steam Workshop (`steamapps/workshop/content/233860/`).
- Mod metadata (author, description, dependencies) is read from the binary `.mod` file header.
- Dependencies are matched using case-insensitive substring matching.
- Conflict detection parses `.mod` files for data conflicts, `.level` files for world/interior conflicts, and scans directories for asset overrides.
- Level data items with zone coordinates are mapped to the Kenshi world map for visual conflict display.
- Load order is saved to `{GamePath}/data/mods.cfg` — the same file Kenshi reads.
- Categories, mod assignments, and ordering are persisted in `%APPDATA%/kenshi-mod-sorter/config.json`.

## AI Sort Export Modes

- **Uncategorized Only** — Only unsorted mods, full descriptions (recommended)
- **Uncategorized Compact** — Unsorted mods with tags + truncated descriptions (best for 50+ mods)
- **All Mods Compact** — Everything in one file with tags + short descriptions (handles 500+ mods)
- **All Mods Full** — Complete descriptions (most accurate, largest file)
- **Split Batches** — Multiple files with ~50 mods each

## License

[MIT](LICENSE) — original work © 2026 Derthi, modifications © 2026 skybogli.

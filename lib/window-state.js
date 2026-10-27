// The main window's size, place and maximized state, kept between runs (window-state.json in
// the app's data folder). First run: 1280 × 800 in the middle of the main screen. There is no
// smallest size (with the page zoomed out, a small window still works). Window menu →
// "Remember window size and place" turns it off: then every start is the first-run window.
//
// A saved place can be wrong by the next start: a monitor unplugged, the screen layout or
// resolution changed, or the window dragged mostly off screen. If the top of the window (where
// it's grabbed to move it) isn't on a screen far enough to grab, it's brought back onto the
// nearest screen; a window bigger than that screen is made to fit.
const { screen } = require('electron');
const fs = require('fs');
const path = require('path');

const FIRST = { width: 1280, height: 800 };
const GRAB_HEIGHT = 40; // the title bar and menu
const GRAB_WIDTH = 120; // at least this much of it on a screen
const SMALLEST = { width: 320, height: 200 }; // a saved size below this (a broken file) isn't used

function fileOf(app) {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readFile(app) {
  try {
    const s = JSON.parse(fs.readFileSync(fileOf(app), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

let remember = null; // read once, then kept here

function remembering(app) {
  if (remember === null) remember = readFile(app).remember !== false;
  return remember;
}

function read(app) {
  if (!remembering(app)) return null;
  try {
    const s = readFile(app);
    const n = (v) => typeof v === 'number' && Number.isFinite(v);
    if (![s.x, s.y, s.width, s.height].every(n) || s.width < SMALLEST.width || s.height < SMALLEST.height) return null;
    return { x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height), maximized: !!s.maximized };
  } catch {
    return null;
  }
}

// Can the top of the window be grabbed on some screen?
function grabbable(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const across = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    return across >= Math.min(GRAB_WIDTH, b.width) && b.y >= a.y && b.y + GRAB_HEIGHT <= a.y + a.height;
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// Where the window opens: { x?, y?, width, height, maximized }.
function initialBounds(app) {
  const saved = read(app);
  if (!saved) {
    // No x / y: Electron puts it in the middle of the main screen.
    const a = screen.getPrimaryDisplay().workArea;
    return { width: Math.min(FIRST.width, a.width), height: Math.min(FIRST.height, a.height), maximized: false };
  }
  const a = screen.getDisplayMatching(saved).workArea; // the screen it's (mostly, or nearest) on
  const width = Math.min(saved.width, a.width);
  const height = Math.min(saved.height, a.height);
  let { x, y } = saved;
  if (width !== saved.width || height !== saved.height || !grabbable({ x, y, width, height })) {
    x = clamp(x, a.x, a.x + a.width - width);
    y = clamp(y, a.y, a.y + a.height - height);
  }
  return { x, y, width, height, maximized: saved.maximized };
}

function write(app, state) {
  try {
    fs.writeFileSync(fileOf(app), JSON.stringify(state));
  } catch {
    // Not saved this time; the window still works.
  }
}

function saveNow(win, app) {
  if (!win || win.isDestroyed()) return;
  if (!remembering(app)) return write(app, { remember: false });
  // The size it has when not maximized / full screen / minimized (what "Restore" gives back).
  const b = win.getNormalBounds();
  write(app, { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
}

// Window menu checkbox. Off forgets the saved window; on saves the window as it is now.
function setRemember(win, app, on) {
  remember = !!on;
  saveNow(win, app);
}

// Keep the window's state up to date: after a move or resize settles, and when it closes.
function track(win, app) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    saveNow(win, app);
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, later);
  win.on('close', save);
}

// Maximize ↔ the size before (Window menu, Ctrl+Shift+M).
function toggleMaximize(win) {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

module.exports = { initialBounds, track, toggleMaximize, remembering, setRemember };

r"""Builds a portable Windows folder of BEEP Kenshi Mod Manager without Node/npm.

It copies an existing build of this app (its Electron runtime, exe and icon),
replaces resources/app.asar with this source, and saves a copy of the source.

Usage: python tools/build.py [runtime folder] [output folder]
       python tools/build.py --source-only   (only save this version's source copy)

Defaults: runtime = the newest D:\켄시\BEEP-Kenshi-Mod-Manager-v*-win64,
          output  = D:\켄시\BEEP-Kenshi-Mod-Manager-v<version>-win64,
          source  = D:\켄시\Source Code\BEEP-Kenshi-Mod-Manager-v<version>
"""
import json, os, re, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asar  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.dirname(ROOT)                    # D:\켄시\Source Code
BUILD_DIR = os.path.dirname(SOURCE_DIR)               # D:\켄시
NAME = 'BEEP-Kenshi-Mod-Manager'


def default_runtime(exclude):
    """The newest existing build folder (its Electron runtime is reused)."""
    found = []
    for name in os.listdir(BUILD_DIR):
        m = re.fullmatch(rf'{re.escape(NAME)}-v(\d+)\.(\d+)\.(\d+)-win64', name)
        p = os.path.join(BUILD_DIR, name)
        if m and p != exclude and os.path.isfile(os.path.join(p, 'resources', 'app.asar')):
            found.append((tuple(map(int, m.groups())), p))
    if not found:
        sys.exit(f'no {NAME}-v*-win64 build found in {BUILD_DIR} to take the runtime from')
    return max(found)[1]

# What goes into app.asar (same set as the electron-builder "files" list).
APP_FILES = ['main.js', 'preload.js', 'preload-viewer.js', 'icon.ico', 'lib', 'renderer']
# package.json keys the app needs at run time (the build config stays out).
PACKAGE_KEYS = ['name', 'version', 'description', 'main', 'license', 'repository']
# Everything kept in a source copy.
SOURCE_FILES = ['package.json', 'package-lock.json', 'main.js', 'preload.js', 'preload-viewer.js', 'README.md', 'LICENSE',
                'PLAN-database-builder.md', 'BEEP-Dev.bat', '.gitignore', 'icon.ico', 'icon.png',
                'lib', 'renderer', 'tools']


def version():
    return json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']


def copy_runtime(src, out):
    """Copy a built app folder, leaving out its app.asar."""
    skip = shutil.ignore_patterns('app.asar', 'app.asar.unpacked', 'app')
    shutil.copytree(src, out, ignore=lambda d, names: skip(d, names) if os.path.basename(d) == 'resources' else [])


def pack_app(out):
    staging = os.path.join(ROOT, 'build-staging')
    if os.path.exists(staging):
        shutil.rmtree(staging)
    os.makedirs(staging)
    for name in APP_FILES:
        p = os.path.join(ROOT, name)
        if os.path.isdir(p):
            shutil.copytree(p, os.path.join(staging, name))
        else:
            shutil.copy2(p, staging)
    pkg = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))
    with open(os.path.join(staging, 'package.json'), 'w', encoding='utf-8') as f:
        json.dump({k: pkg[k] for k in PACKAGE_KEYS if k in pkg}, f, indent=2)
    asar.pack(staging, os.path.join(out, 'resources', 'app.asar'))
    shutil.rmtree(staging)


def save_source(ver):
    dest = os.path.join(SOURCE_DIR, f'{NAME}-v{ver}')
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    skip = shutil.ignore_patterns('__pycache__', '*.pyc', 'node_modules', 'dist', 'build-staging')
    for name in SOURCE_FILES:
        src = os.path.join(ROOT, name)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(dest, name), ignore=skip)
        elif os.path.isfile(src):
            shutil.copy2(src, dest)
    return dest


def main():
    ver = version()
    if sys.argv[1:] == ['--source-only']:
        print('source saved', save_source(ver))
        return
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BUILD_DIR, f'{NAME}-v{ver}-win64')
    runtime = sys.argv[1] if len(sys.argv) > 1 else default_runtime(out)
    print('runtime from', runtime)
    if os.path.exists(out):
        sys.exit(f'output folder already exists: {out}')
    copy_runtime(runtime, out)
    pack_app(out)
    shutil.copy2(os.path.join(ROOT, 'LICENSE'), out)  # MIT: the notice goes with every copy
    print('built', out)
    print('source saved', save_source(ver))


if __name__ == '__main__':
    main()

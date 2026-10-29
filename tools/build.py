r"""Builds a portable Windows folder of BEEP Kenshi Mod Manager without Node/npm.

It copies an existing build of this app (its Electron runtime, exe and icon),
replaces resources/app.asar with this source, and saves a copy of the source.

Usage: python tools/build.py [runtime folder] [output folder]
       python tools/build.py --source-only   (only save this version's source copy)
       python tools/build.py --from-source <version> [runtime folder] [output folder]
              (rebuild an old version from its source copy, e.g. to test the in-app update;
               no release zip, no source copy)
       python tools/build.py --cleanup-list  (only list the builds that may go to the Recycle Bin)

Defaults: runtime = the newest D:\모드 관리자 개발\Kenshi\BEEP-Kenshi-Mod-Manager-v*-win64,
          output  = D:\모드 관리자 개발\Kenshi\BEEP-Kenshi-Mod-Manager-v<version>-win64,
          source  = D:\모드 관리자 개발\Kenshi\Source Code\BEEP-Kenshi-Mod-Manager-v<version>
Run it from the working source folder only (not from a version's source copy).
"""
import json, os, re, shutil, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asar  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.dirname(ROOT)                    # D:\모드 관리자 개발\Kenshi\Source Code
BUILD_DIR = os.path.dirname(SOURCE_DIR)               # D:\모드 관리자 개발\Kenshi
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


def version(root=ROOT):
    return json.load(open(os.path.join(root, 'package.json'), encoding='utf-8'))['version']


def copy_runtime(src, out):
    """Copy a built app folder, leaving out its app.asar, backups and what its user saved there
    (modpacks: the packs live next to the exe), so a build never carries anyone's packs."""
    skip_res = shutil.ignore_patterns('app.asar', 'app.asar.unpacked', 'app', '*.bak')
    skip_top = shutil.ignore_patterns('modpacks', 'update.zip', '*.bak')
    def ignore(d, names):
        if os.path.normcase(os.path.abspath(d)) == os.path.normcase(os.path.abspath(src)):
            return skip_top(d, names)
        return skip_res(d, names) if os.path.basename(d) == 'resources' else []
    shutil.copytree(src, out, ignore=ignore)


def pack_app(out, root=ROOT):
    """Pack root's app files (this source, or an old version's source copy) into out's app.asar."""
    staging = os.path.join(ROOT, 'build-staging')
    if os.path.exists(staging):
        shutil.rmtree(staging)
    os.makedirs(staging)
    for name in APP_FILES:
        p = os.path.join(root, name)
        if os.path.isdir(p):
            shutil.copytree(p, os.path.join(staging, name))
        elif os.path.isfile(p):
            shutil.copy2(p, staging)
        else:
            print('warning: not in this source, skipped:', name)  # an old copy may not have it yet
    pkg = json.load(open(os.path.join(root, 'package.json'), encoding='utf-8'))
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


def release_zip(out, version):
    """The zip to put on a GitHub release, in the releases folder next to the builds: the build folder's
    files at its top (the exe right there, as the in-app update expects), named …-x64.zip: v1.2.111/114's in-app update installs a "win" zip in place and restarts in a loop;
    without what a user saved in the folder (modpacks) or backups."""
    import zipfile
    folder = os.path.join(BUILD_DIR, 'releases')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f'BEEP-Kenshi-Mod-Manager-v{version}-x64.zip')
    with zipfile.ZipFile(path + '.tmp', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(out):
            if os.path.normcase(root) == os.path.normcase(out):
                dirs[:] = [d for d in dirs if d != 'modpacks']
            for f in files:
                if f.endswith(('.bak', '.zip', '.tmp')):
                    continue
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, out))
    os.replace(path + '.tmp', path)
    return path


def running_dirs():
    """Folders of the exes running now (None if that can't be told)."""
    cmd = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process | Where-Object Path | ForEach-Object { $_.Path }'
    try:
        r = subprocess.run(['powershell.exe', '-NoProfile', '-Command', cmd], capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    paths = r.stdout.decode('utf-8', 'replace').splitlines()
    return {os.path.normcase(os.path.dirname(p.strip())) for p in paths if p.strip()}


def cleanup_list():
    """Print the builds that may go to the Recycle Bin (nothing is removed): the builds that have a
    source copy, all but the newest 3 of them. Kept anyway: builds without a source copy, the
    original v1.2.11, running builds and builds holding modpacks (the user's presets)."""
    builds = []
    for name in os.listdir(BUILD_DIR):
        m = re.fullmatch(rf'{re.escape(NAME)}-v((\d+)\.(\d+)\.(\d+))-win64', name)
        if m and os.path.isdir(os.path.join(SOURCE_DIR, f'{NAME}-v{m.group(1)}')):
            builds.append((tuple(map(int, m.groups()[1:])), m.group(1), os.path.join(BUILD_DIR, name)))
    builds.sort(reverse=True)
    running = running_dirs()
    found = False
    for _, ver, path in builds[3:]:
        name = os.path.basename(path)
        if ver == '1.2.11':
            continue
        if running is None or os.path.normcase(path) in running:
            print(f'  keep {name}: ' + ('running' if running is not None else 'could not check if it is running'))
        elif os.path.isdir(os.path.join(path, 'modpacks')):
            print(f'  keep {name}: holds modpacks (move them to the newest build first?)')
        else:
            print(f'  may go to the Recycle Bin: {name}')
            found = True
    if not found:
        print('  nothing to clean up (newest 3 with a source copy:', ', '.join(v for _, v, _ in builds[:3]) + ')')


def from_source(ver, runtime, out):
    """Rebuild an old version from its source copy (packed by this script; no release zip, no source copy)."""
    src = os.path.join(SOURCE_DIR, f'{NAME}-v{ver}')
    if not os.path.isfile(os.path.join(src, 'package.json')):
        sys.exit(f'no source copy for v{ver}: {src}')
    if version(src) != ver:
        sys.exit(f'{src} says version {version(src)}, not {ver}')
    out = out or os.path.join(BUILD_DIR, f'{NAME}-v{ver}-win64')
    runtime = runtime or default_runtime(out)
    print('runtime from', runtime)
    if os.path.exists(out):
        sys.exit(f'output folder already exists: {out}')
    copy_runtime(runtime, out)
    pack_app(out, src)
    shutil.copy2(os.path.join(src if os.path.isfile(os.path.join(src, 'LICENSE')) else ROOT, 'LICENSE'), out)
    print('built', out, '(from the source copy; no release zip, no source copy)')


def main():
    # From a version's source copy, save_source would wipe that very copy: only the working folder builds.
    if os.path.basename(ROOT) != NAME:
        sys.exit(f'this is a source copy ({ROOT}), not the working folder.\n'
                 f'Build old versions from {os.path.join(SOURCE_DIR, NAME)} with: python -I tools/build.py --from-source <version>')
    ver = version()
    if sys.argv[1:] == ['--source-only']:
        print('source saved', save_source(ver))
        return
    if sys.argv[1:] == ['--cleanup-list']:
        cleanup_list()
        return
    if sys.argv[1:2] == ['--from-source']:
        if len(sys.argv) < 3:
            sys.exit(__doc__)
        from_source(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None, sys.argv[4] if len(sys.argv) > 4 else None)
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
    if len(sys.argv) <= 2:
        print('release zip', release_zip(out, ver))
    print('source saved', save_source(ver))
    print('cleanup (nothing removed):')
    cleanup_list()


if __name__ == '__main__':
    main()

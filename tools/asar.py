"""Minimal asar extract/pack. Usage:
  asar.py extract <archive> <outdir>
  asar.py pack <srcdir> <archive>
"""
import hashlib, json, os, struct, sys

BLOCK = 4 * 1024 * 1024


def read_header(f):
    _, header_size = struct.unpack('<II', f.read(8))
    hdr = f.read(header_size)
    _, str_len = struct.unpack('<II', hdr[:8])
    return json.loads(hdr[8:8 + str_len].decode('utf-8')), 8 + header_size


def extract(archive, out):
    with open(archive, 'rb') as f:
        header, base = read_header(f)

        def walk(node, rel):
            for name, ent in node['files'].items():
                p = os.path.join(out, rel, name)
                if 'files' in ent:
                    os.makedirs(p, exist_ok=True)
                    walk(ent, os.path.join(rel, name))
                elif ent.get('unpacked') or 'link' in ent:
                    print('skip (unpacked/link):', os.path.join(rel, name))
                else:
                    f.seek(base + int(ent['offset']))
                    with open(p, 'wb') as o:
                        o.write(f.read(ent['size']))
        os.makedirs(out, exist_ok=True)
        walk(header, '')
    return header


def integrity(data):
    return {
        'algorithm': 'SHA256',
        'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': BLOCK,
        'blocks': [hashlib.sha256(data[i:i + BLOCK]).hexdigest()
                   for i in range(0, max(len(data), 1), BLOCK)],
    }


def pack(src, archive):
    blobs, offset = [], 0

    def walk(path):
        nonlocal offset
        node = {'files': {}}
        for name in sorted(os.listdir(path)):
            p = os.path.join(path, name)
            if os.path.isdir(p):
                node['files'][name] = walk(p)
            else:
                data = open(p, 'rb').read()
                node['files'][name] = {'size': len(data), 'offset': str(offset),
                                       'integrity': integrity(data)}
                blobs.append(data)
                offset += len(data)
        return node

    header = json.dumps(walk(src), separators=(',', ':')).encode('utf-8')
    pad = (4 - len(header) % 4) % 4
    payload = struct.pack('<I', len(header)) + header + b'\0' * pad
    pickle = struct.pack('<I', len(payload)) + payload
    with open(archive, 'wb') as f:
        f.write(struct.pack('<II', 4, len(pickle)))
        f.write(pickle)
        for b in blobs:
            f.write(b)


if __name__ == '__main__':
    cmd, a, b = sys.argv[1:4]
    if cmd == 'extract':
        extract(a, b)
    elif cmd == 'pack':
        pack(a, b)

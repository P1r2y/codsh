import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install


class InstallerTests(unittest.TestCase):
    def archive(self, file, entries):
        header, data = {}, b''
        for name, content in entries.items():
            install.put(header, name, {'size':len(content), 'offset':str(len(data)), 'integrity':install.integrity(content)})
            data += content
        raw = json.dumps(header).encode()
        padded = raw + b'\0' * ((-len(raw)) % 4)
        pickle = struct.pack('<II', len(padded)+4, len(raw)) + padded
        file.write_bytes(struct.pack('<II', 4, len(pickle)) + pickle + data)

    def test_bridge_preserves_native_renderer_and_original(self):
        with tempfile.TemporaryDirectory(prefix='codsh-archive-') as folder:
            source, output = Path(folder)/'original.asar', Path(folder)/'output.asar'
            entries = {'package.json':json.dumps({'version':install.VERSION}).encode(),
                '.vite/build/early-bootstrap.js':b'originalMain();',
                '.vite/build/preload.js':b'originalPreload();',
                'webview/assets/thread.js':b'originalReact();'}
            self.archive(source, entries)
            original = source.read_bytes()
            changed = install.build_archive(source, output)
            self.assertEqual(set(changed), {'.vite/build/early-bootstrap.js', '.vite/build/preload.js',
                '.vite/build/enhancement-loader.cjs', '.vite/build/protocol.cjs'})
            header, offset = install.read_header(output)
            self.assertEqual(install.read_entry(output, header, offset, 'webview/assets/thread.js'), entries['webview/assets/thread.js'])
            old_header, _ = install.read_header(source)
            self.assertEqual(install.entry(header, 'webview/assets/thread.js'), install.entry(old_header, 'webview/assets/thread.js'))
            self.assertEqual(source.read_bytes(), original)

    def test_unsupported_client_stops_before_writing(self):
        with tempfile.TemporaryDirectory(prefix='codsh-version-') as folder:
            source, output = Path(folder)/'original.asar', Path(folder)/'output.asar'
            self.archive(source, {'package.json':b'{"version":"0.0.0"}'})
            with self.assertRaisesRegex(RuntimeError, '未适配'): install.build_archive(source, output)
            self.assertFalse(output.exists())

    def test_prebuilt_bundle_matches_sources(self):
        install.verify_bundles()


if __name__ == '__main__': unittest.main()

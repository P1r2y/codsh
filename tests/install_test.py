import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install


class InstallerTests(unittest.TestCase):
    def entries(self, version=None):
        return {
            'package.json':json.dumps({'version':version or install.VERSION, 'main':install.BRIDGE_MAIN}).encode(),
            install.BRIDGE_MAIN:b'require("electron");originalMain();',
            install.BRIDGE_PRELOAD:b'require("electron");originalPreload("codex_desktop:message-for-view");',
            'webview/assets/thread.js':('originalReact();'+','.join(install.NATIVE_MARKERS)).encode()
        }

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
            entries = self.entries()
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

    def test_native_markers_in_nested_assets_are_checked(self):
        with tempfile.TemporaryDirectory(prefix='codsh-nested-') as folder:
            archive = Path(folder)/'app.asar'
            entries = self.entries()
            entries['webview/assets/async/thread.js'] = entries.pop('webview/assets/thread.js')
            self.archive(archive, entries)
            self.assertEqual(install.validate_client(archive), install.VERSION)

    def test_each_declared_version_and_native_structure(self):
        with tempfile.TemporaryDirectory(prefix='codsh-compat-') as folder:
            archive = Path(folder)/'app.asar'
            for version in install.CLIENT_VERSIONS:
                self.archive(archive, self.entries(version))
                self.assertEqual(install.validate_client(archive), version)
            broken = self.entries()
            broken['webview/assets/thread.js'] = b'changedNativeUI();'
            self.archive(archive, broken)
            with self.assertRaisesRegex(RuntimeError, '原生界面结构不匹配'): install.validate_client(archive)
            broken = self.entries()
            broken['webview/assets/thread.js'] = broken['webview/assets/thread.js'].replace(b'data-chatgpt-composer', b'changed-composer-mode')
            self.archive(archive, broken)
            with self.assertRaisesRegex(RuntimeError, '原生界面结构不匹配'): install.validate_client(archive)
            broken = self.entries()
            broken[install.BRIDGE_PRELOAD] = b'changedPreload();'
            self.archive(archive, broken)
            with self.assertRaisesRegex(RuntimeError, '加载入口结构不匹配'): install.validate_client(archive)
            broken[install.BRIDGE_PRELOAD] = b'require("electron");changedNativeChannel();'
            self.archive(archive, broken)
            with self.assertRaisesRegex(RuntimeError, '原生额度通知入口不匹配'): install.validate_client(archive)

    def test_source_selection_uses_latest_original_without_downgrading(self):
        with tempfile.TemporaryDirectory(prefix='codsh-sources-') as folder:
            candidates = []
            for version in [*install.CLIENT_VERSIONS, '99.1.1']:
                app = Path(folder)/version/'app'
                (app/'resources').mkdir(parents=True)
                (app/'ChatGPT.exe').write_bytes(b'test')
                self.archive(app/'resources/app.asar', self.entries(version))
                candidates.append(app.resolve())
            self.assertEqual(install.choose_source(candidates), candidates[-1])
            with self.assertRaisesRegex(RuntimeError, '未适配'): install.validate_client(candidates[-1]/'resources/app.asar')
            (candidates[-1]/'resources/codsh-loader.json').write_text('{}')
            self.assertEqual(install.choose_source(candidates), candidates[-2])
            # 旧加载器没有外置配置，也不能当作原版再次叠加入口。
            self.archive(candidates[-2]/'resources/app.asar', {**self.entries(), '.vite/build/enhancement-loader.cjs':b'loader();'})
            self.assertEqual(install.choose_source(candidates), candidates[-3])
            with self.assertRaisesRegex(RuntimeError, '已包含加载器'): install.validate_client(candidates[-2]/'resources/app.asar')

    def test_install_preserves_plugin_switch_and_other_plugins(self):
        with tempfile.TemporaryDirectory(prefix='codsh-settings-') as folder:
            destination = Path(folder)
            settings = destination/'plugins.json'
            original = {'loaderVersion':1, 'plugins':{'codex-usage':{'enabled':False}, 'other':{'enabled':True}}, 'extra':7}
            settings.write_text(json.dumps(original))
            # 写入真实构建与源码；这里只隔离图标来源，不启动客户端。
            install.install_plugin(destination/'source/app', destination)
            actual = json.loads(settings.read_text())
            self.assertEqual(actual['loaderVersion'], install.MANIFEST['loaderVersion'])
            self.assertEqual(actual['plugins'], original['plugins'])
            self.assertEqual(actual['extra'], 7)
            self.assertEqual((destination/'plugins/codex-usage/lib/project-cache.cjs').read_bytes(),
                             (install.ROOT/'src/project-cache.cjs').read_bytes())
            for name in ['project-cache-worker.cjs', 'log-watch.cjs']:
                self.assertEqual((destination/'plugins/codex-usage/lib'/name).read_bytes(),
                                 (install.ROOT/'src'/name).read_bytes())

    @unittest.skipUnless(sys.platform == 'win32', 'Windows launcher')
    def test_pending_enable_is_one_shot_and_explicit_disable_cancels_it(self):
        with tempfile.TemporaryDirectory(prefix='codsh-launch-') as folder:
            destination = Path(folder)
            install.install_controls(destination)
            settings = destination/'plugins.json'
            settings.write_text(json.dumps({'plugins':{'codex-usage':{'enabled':False}}}), encoding='utf-8')
            (destination/'installation.json').write_text(json.dumps({'runtime':str(destination/'runtime'/'app')}), encoding='utf-8')
            pending = destination/'enable-on-next-start.flag'
            pending.write_text('', encoding='utf-8')
            environment = dict(os.environ, CODSH_TEST_DIR=str(destination))
            script = r'''function Get-CimInstance { param($Filter) @() }
function Start-Process { param($FilePath,$WorkingDirectory,$WindowStyle) }
& (Join-Path $env:CODSH_TEST_DIR 'Start-CodexUsageUI.ps1')'''
            subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
                           env=environment, check=True, capture_output=True)
            self.assertTrue(json.loads(settings.read_text(encoding='utf-8'))['plugins']['codex-usage']['enabled'])
            self.assertFalse(pending.exists())
            pending.write_text('', encoding='utf-8')
            subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                            str(destination/'Disable-UsagePlugin.ps1')], check=True, capture_output=True)
            self.assertFalse(json.loads(settings.read_text(encoding='utf-8'))['plugins']['codex-usage']['enabled'])
            self.assertFalse(pending.exists())


if __name__ == '__main__': unittest.main()

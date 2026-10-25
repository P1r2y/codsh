"""在隔离的 Electron 进程中运行真实 Chromium 界面测试。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from install import clone_runtime, find_source, prepare_portable_executable, verify_bundles, write_archive


def run(source, output):
    verify_bundles()
    subprocess.run(['node', str(ROOT/'tests/make-fixture.cjs')], check=True)
    workspace = Path(tempfile.mkdtemp(prefix='codsh-ui-'))
    runtime = workspace/'app'
    clone_runtime(source, runtime)
    independent = runtime/'ChatGPT.test-building'
    shutil.copy2(source/'ChatGPT.exe', independent)
    os.replace(independent, runtime/'ChatGPT.exe')
    manifest = json.loads((ROOT/'plugin/plugin.json').read_text(encoding='utf-8'))
    write_archive(source/'resources/app.asar', runtime/'resources/app.asar', {
        'package.json':json.dumps({'name':'codsh-ui-tests', 'version':manifest['version'], 'main':'.vite/build/codsh-ui-test.cjs'}).encode(),
        '.vite/build/codsh-ui-test.cjs':('require('+json.dumps(str(ROOT/'tests/ui.integration.cjs'))+');').encode()
    })
    prepare_portable_executable(runtime/'ChatGPT.exe', runtime/'resources/app.asar')
    output.parent.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, CODEX_USAGE_UI_TEST_OUTPUT=str(output))
    environment.pop('ELECTRON_RUN_AS_NODE', None)
    with output.with_suffix('.log').open('wb') as log:
        process = subprocess.Popen([str(runtime/'ChatGPT.exe'), '--user-data-dir='+str(workspace/'profile')],
            env=environment, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try: process.wait(timeout=120)
        except subprocess.TimeoutExpired:
            process.kill()
            raise RuntimeError('界面测试超时；仅停止独立测试进程')
    report = json.loads(output.read_text(encoding='utf-8')) if output.is_file() else {}
    if not report.get('ok'):
        failures = [name for name, passed in report.get('checks', {}).items() if not passed]
        raise RuntimeError(str(failures or report.get('error') or '测试进程未生成报告')+'；'+str(output))
    print(f"界面检查 {len(report['checks'])} 项通过；{output}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/ui/report.json')
    args = parser.parse_args()
    run(args.source or find_source(), args.output.resolve())

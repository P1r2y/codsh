"""安装 Codex 本地增强插件和最小加载入口。"""
from __future__ import annotations
import argparse
import copy
import ctypes
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import struct
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parent
DEFAULT = Path(os.environ['LOCALAPPDATA']) / 'CodexUsageUI'
VERSION = json.loads((ROOT/'plugin/plugin.json').read_text(encoding='utf-8'))['clientVersion']

def read_header(p):
    with p.open('rb') as f:
        h = struct.unpack('<IIII', f.read(16))
        return json.loads(f.read(h[3])), 8 + h[1]

def entry(root, name):
    d = root
    for part in name.split('/'):
        d = d['files'][part]
    return d

def read_entry(archive, header, offset, name):
    d = entry(header, name)
    with archive.open('rb') as f:
        f.seek(offset + int(d['offset']))
        return f.read(d['size'])

def put(root, name, value):
    d = root
    parts = name.split('/')
    for part in parts[:-1]:
        d = d.setdefault('files', {}).setdefault(part, {'files': {}})
    d.setdefault('files', {})[parts[-1]] = value

def integrity(data):
    block = 4 * 1024 * 1024
    return {'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),
            'blockSize':block,'blocks':[hashlib.sha256(data[i:i+block]).hexdigest() for i in range(0,len(data),block)]}

def write_archive(source, target, changes):
    """保留原条目，只在独立输出中添加或更新指定入口。"""
    header, offset = read_header(source)
    next_offset = source.stat().st_size - offset
    new_header = copy.deepcopy(header)
    for name, data in changes.items():
        put(new_header, name, {'size':len(data), 'offset':str(next_offset), 'integrity':integrity(data)})
        next_offset += len(data)
    raw = json.dumps(new_header, ensure_ascii=False, separators=(',', ':')).encode()
    padded = raw + b'\0' * ((-len(raw)) % 4)
    header_pickle = struct.pack('<II', len(padded)+4, len(raw)) + padded
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.building')
    with temporary.open('wb') as out, source.open('rb') as inp:
        out.write(struct.pack('<II', 4, len(header_pickle)))
        out.write(header_pickle)
        inp.seek(offset)
        shutil.copyfileobj(inp, out, 1024*1024)
        for data in changes.values(): out.write(data)
    os.replace(temporary, target)


def build_archive(source, target):
    header, offset = read_header(source)
    version = json.loads(read_entry(source, header, offset, 'package.json'))['version']
    if version != VERSION:
        raise RuntimeError(f'客户端版本 {version} 未适配；仅支持 {VERSION}')
    early, preload = '.vite/build/early-bootstrap.js', '.vite/build/preload.js'
    changes = {
        early: b"require('./enhancement-loader.cjs').register();\n" + read_entry(source, header, offset, early),
        preload: read_entry(source, header, offset, preload) + b'\n;' + (ROOT/'dist/enhancement-preload.cjs').read_bytes(),
        '.vite/build/enhancement-loader.cjs': (ROOT/'src/enhancement-loader.cjs').read_bytes(),
        '.vite/build/protocol.cjs': (ROOT/'src/protocol.cjs').read_bytes()
    }
    write_archive(source, target, changes)
    return {name:hashlib.sha256(data).hexdigest() for name, data in changes.items()}


def find_source():
    result = subprocess.run(['powershell','-NoProfile','-Command',
        "Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty InstallLocation"],capture_output=True,text=True,check=True)
    candidates = [Path(p.strip())/'app' for p in result.stdout.splitlines() if p.strip()]
    candidates = [p for p in candidates if (p/'resources/app.asar').is_file()]
    if len(candidates) != 1: raise RuntimeError('未找到唯一的 Codex 安装目录')
    return candidates[0]

def clone_runtime(source, target):
    count = {'linked':0,'copied':0}
    for base, dirs, names in os.walk(source):
        relative = Path(base).relative_to(source)
        dest_dir = target/relative
        dest_dir.mkdir(parents=True,exist_ok=True)
        for name in names:
            rel = relative/name
            if rel == Path('resources/app.asar'): continue
            src, dst = source/rel, target/rel
            if dst.exists(): continue
            try:
                os.link(src,dst);count['linked']+=1
            except OSError:
                shutil.copy2(src,dst);count['copied']+=1
    return count

def prepare_portable_executable(executable, archive):
    """为用户目录副本生成匹配的程序集清单与 ASAR 摘要，保留完整性校验。"""
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    pointer = ctypes.c_void_p
    signatures = [
        ('LoadLibraryExW',[ctypes.c_wchar_p,pointer,ctypes.c_uint],pointer),
        ('FindResourceW',[pointer,pointer,pointer],pointer),
        ('SizeofResource',[pointer,pointer],ctypes.c_uint),
        ('LoadResource',[pointer,pointer],pointer),('LockResource',[pointer],pointer),
        ('FreeLibrary',[pointer],ctypes.c_int),
        ('EnumResourceLanguagesW',[pointer,pointer,pointer,pointer,pointer],ctypes.c_int),
        ('BeginUpdateResourceW',[ctypes.c_wchar_p,ctypes.c_int],pointer),
        ('UpdateResourceW',[pointer,pointer,pointer,ctypes.c_ushort,pointer,ctypes.c_uint],ctypes.c_int),
        ('EndUpdateResourceW',[pointer,ctypes.c_int],ctypes.c_int)]
    for name, args, result in signatures:
        fn=getattr(k,name);fn.argtypes=args;fn.restype=result
    h=k.LoadLibraryExW(str(executable),None,2)
    if not h: raise ctypes.WinError(ctypes.get_last_error())
    integrity_type=ctypes.c_wchar_p('INTEGRITY');integrity_name=ctypes.c_wchar_p('ELECTRONASAR')
    def resource(kind,name):
        r=k.FindResourceW(h,name,kind)
        if not r:raise ctypes.WinError(ctypes.get_last_error())
        return ctypes.string_at(k.LockResource(k.LoadResource(h,r)),k.SizeofResource(h,r))
    manifest=resource(24,1).decode('utf-8')
    manifest=re.sub(r'<dependency><dependentAssembly><assemblyIdentity type="win32" name="\d+\.\d+\.\d+\.\d+"[^>]+/></dependentAssembly></dependency>','',manifest)
    records=json.loads(resource(integrity_type,integrity_name))
    with archive.open('rb') as f:
        sizes=struct.unpack('<IIII',f.read(16));hash_value=hashlib.sha256(f.read(sizes[3])).hexdigest()
    for record in records:
        if record['file'].replace('\\','/')=='resources/app.asar':record['value']=hash_value
    languages={}
    for key,kind,name in [('manifest',24,1),('integrity',integrity_type,integrity_name)]:
        values=[]
        @ctypes.WINFUNCTYPE(ctypes.c_int,pointer,pointer,pointer,ctypes.c_ushort,pointer)
        def capture(module, resource_type, resource_name, language, context):
            values.append(language);return 1
        if not k.EnumResourceLanguagesW(h,kind,name,capture,None):raise ctypes.WinError(ctypes.get_last_error())
        languages[key]=values
    k.FreeLibrary(h)
    updates=[(24,1,manifest.encode(),languages['manifest']),
             (integrity_type,integrity_name,json.dumps(records,separators=(',',':')).encode(),languages['integrity'])]
    handle=k.BeginUpdateResourceW(str(executable),False)
    if not handle:raise ctypes.WinError(ctypes.get_last_error())
    try:
        for kind,name,data,langs in updates:
            buf=ctypes.create_string_buffer(data)
            for language in langs:
                if not k.UpdateResourceW(handle,kind,name,language,buf,len(data)):
                    raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        k.EndUpdateResourceW(handle,True);raise
    if not k.EndUpdateResourceW(handle,False):raise ctypes.WinError(ctypes.get_last_error())
    return hash_value


def file_hash(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def verify_bundles():
    digest = hashlib.sha256()
    files = sorted(p for p in (ROOT/'src').rglob('*') if p.suffix in {'.mjs', '.cjs', '.css'})
    for file in files:
        digest.update(file.relative_to(ROOT).as_posix().encode() + b'\0')
        digest.update(file.read_text(encoding='utf-8').replace('\r\n', '\n').encode() + b'\0')
    expected = b'// codsh-source-sha256:' + digest.hexdigest().encode()
    for name in ['usage-preload.cjs', 'enhancement-preload.cjs']:
        file = ROOT/'dist'/name
        if not file.is_file() or file.read_bytes().splitlines()[0] != expected:
            raise RuntimeError('构建文件缺失或已过期；开发者请运行 npm ci --ignore-scripts 和 npm run build')


def write_atomic(target, data):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, target)


def write_json(target, data):
    write_atomic(target, json.dumps(data, ensure_ascii=False, indent=2).encode())


def prepare_runtime(source, destination, original_hash):
    bridge = hashlib.sha256(original_hash.encode())
    for file in [ROOT/'src/enhancement-loader.cjs', ROOT/'src/protocol.cjs', ROOT/'dist/enhancement-preload.cjs']:
        data = file.read_bytes().replace(b'\r\n', b'\n')
        # 前端版本摘要不影响桥本身的身份，普通插件升级可复用运行时。
        if file.parent.name == 'dist': data = data.split(b'\n', 1)[1]
        bridge.update(data)
    bridge_hash = bridge.hexdigest()
    runtimes = destination/'runtimes'
    runtime = runtimes/f'{VERSION}-{bridge_hash[:16]}'
    if runtime.exists():
        record_file = runtime/'runtime.json'
        if not record_file.is_file(): raise RuntimeError('运行时目录未登记，拒绝覆盖')
        record = json.loads(record_file.read_text(encoding='utf-8'))
        if record['bridgeSha256'] != bridge_hash or record['originalAsarSha256'] != original_hash:
            raise RuntimeError('运行时身份不符')
        for name, digest in record['files'].items():
            if file_hash(runtime/name) != digest: raise RuntimeError('运行时文件校验不符')
        return runtime/'app', True
    staging = runtimes/('.building-'+uuid.uuid4().hex)
    try:
        app = staging/'app'
        clone_runtime(source, app)
        build_archive(source/'resources/app.asar', app/'resources/app.asar')
        independent = app/'ChatGPT.portable-building'
        shutil.copy2(source/'ChatGPT.exe', independent)
        os.replace(independent, app/'ChatGPT.exe')
        prepare_portable_executable(app/'ChatGPT.exe', app/'resources/app.asar')
        write_json(app/'resources/codsh-loader.json', {'base':os.path.relpath(destination, runtime/'app/resources')})
        write_json(staging/'runtime.json', {
            'clientVersion':VERSION, 'bridgeSha256':bridge_hash, 'originalAsarSha256':original_hash,
            'files':{str(p.relative_to(staging)).replace('\\','/'):file_hash(p) for p in [
                app/'ChatGPT.exe', app/'resources/app.asar', app/'resources/codsh-loader.json']}
        })
        staging.rename(runtime)
    except BaseException:
        if staging.exists() and staging.resolve().parent == runtimes.resolve(): shutil.rmtree(staging)
        raise
    return runtime/'app', False


def install_plugin(source, destination):
    plugin = destination/'plugins/codex-usage'
    for file in ['usage-model.cjs', 'usage-data.cjs', 'rollout-store.cjs', 'protocol.cjs', 'usage-host.cjs']:
        write_atomic(plugin/'lib'/file, (ROOT/'src'/file).read_bytes())
    # 提交完整前端后再更新清单，加载器按摘要切换版本。
    write_atomic(plugin/'ui/usage-preload.cjs', (ROOT/'dist/usage-preload.cjs').read_bytes())
    write_atomic(plugin/'plugin.json', (ROOT/'plugin/plugin.json').read_bytes())
    for variant in ['lightunplated', 'unplated']:
        icon = source.parent/'assets'/f'Square44x44Logo.targetsize-32_altform-{variant}.png'
        if icon.is_file(): write_atomic(plugin/'assets/app-icons'/icon.name, icon.read_bytes())
    settings = destination/'plugins.json'
    if not settings.exists(): write_json(settings, {'loaderVersion':2, 'plugins':{'codex-usage':{'enabled':True}}})


def install_controls(destination):
    scripts = {
        'Start-CodexUsageUI.ps1': r'''$ErrorActionPreference='Stop'
$record=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
$base=[IO.Path]::GetFullPath($PSScriptRoot)+[IO.Path]::DirectorySeparatorChar
$runtime=[IO.Path]::GetFullPath((Join-Path $record.runtime 'ChatGPT.exe'))
if(-not $runtime.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){throw '运行时路径无效'}
$existing=Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'Codex|CodexUsageUI' }
if($existing){Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('请先从托盘完全退出 Codex，再重新打开。','Codex') | Out-Null; exit}
Start-Process -FilePath $runtime -WorkingDirectory (Split-Path $runtime) -WindowStyle Hidden
''',
        'Start-OriginalCodex.ps1': r'''$ErrorActionPreference='Stop'
$record=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
$existing=Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'Codex|CodexUsageUI' }
if($existing){Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('请先完全退出 Codex。','Codex') | Out-Null; exit}
Start-Process -FilePath (Join-Path $record.source 'ChatGPT.exe') -WorkingDirectory $record.source -WindowStyle Hidden
''',
        'Set-UsagePlugin.ps1': r'''param([ValidateSet('Enable','Disable')][string]$Mode='Enable')
$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot 'plugins.json'
$settings=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
$settings.plugins.'codex-usage'.enabled=($Mode -eq 'Enable')
$temporary=$file+'.tmp'
[IO.File]::WriteAllText($temporary,($settings | ConvertTo-Json -Depth 8),([Text.UTF8Encoding]::new($false)))
Move-Item -LiteralPath $temporary -Destination $file -Force
''',
        'Uninstall-UsagePlugin.ps1': r'''$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Set-UsagePlugin.ps1') -Mode Disable
$base=[IO.Path]::GetFullPath($PSScriptRoot)
$expected=Join-Path $base 'plugins\codex-usage'
$target=[IO.Path]::GetFullPath($expected)
if(-not [string]::Equals($target,$expected,[StringComparison]::OrdinalIgnoreCase) -or -not $target.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '插件目录校验失败'}
if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
$integration=Join-Path $base 'shortcut-integration.json'
if(Test-Path -LiteralPath $integration){$original=Get-Content -LiteralPath $integration -Raw | ConvertFrom-Json; if(Test-Path -LiteralPath $original.backup){Copy-Item -LiteralPath $original.backup -Destination $original.path -Force}}
'''
    }
    for mode in ['Enable', 'Disable']:
        scripts[mode+'-UsagePlugin.ps1'] = "& (Join-Path $PSScriptRoot 'Set-UsagePlugin.ps1') -Mode "+mode+'\n'
    for name, text in scripts.items(): write_atomic(destination/name, text.encode('utf-8-sig'))


def build(source, destination):
    source, destination = source.resolve(), destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise RuntimeError('安装目录必须独立于原客户端')
    if destination == ROOT or ROOT in destination.parents or destination in ROOT.parents:
        raise RuntimeError('安装目录必须独立于仓库')
    verify_bundles()
    original = source/'resources/app.asar'
    header, offset = read_header(original)
    actual = json.loads(read_entry(original, header, offset, 'package.json'))['version']
    if actual != VERSION: raise RuntimeError(f'客户端版本 {actual} 未适配；仅支持 {VERSION}')
    before = file_hash(original)
    print('准备加载运行时……', flush=True)
    runtime, reused = prepare_runtime(source, destination, before)
    install_plugin(source, destination)
    if file_hash(original) != before: raise RuntimeError('原版文件校验发生变化')
    record = {'pluginVersion':json.loads((ROOT/'plugin/plugin.json').read_text(encoding='utf-8'))['version'],
              'clientVersion':VERSION, 'source':str(source), 'destination':str(destination), 'runtime':str(runtime),
              'originalAsarSha256':before, 'createdAt':time.strftime('%Y-%m-%d %H:%M:%S')}
    write_json(destination/'installation.json', record)
    install_controls(destination)
    print(f"插件 {record['pluginVersion']} 已安装；运行时{'复用' if reused else '新建'}。", flush=True)
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--destination', type=Path, default=DEFAULT)
    args = parser.parse_args()
    build(args.source or find_source(), args.destination)

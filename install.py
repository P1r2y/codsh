"""从已安装客户端构建用户目录定制副本；不写入原版安装目录。"""
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

ROOT = Path(__file__).resolve().parent
DEFAULT = Path(os.environ['LOCALAPPDATA']) / 'CodexUsageUI'
VERSION = '26.1013.40934'

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

def patch_asar(source, target):
    header, offset = read_header(source)
    version = json.loads(read_entry(source,header,offset,'package.json'))['version']
    if version != VERSION:
        raise RuntimeError(f'客户端版本 {version} 未适配；当前补丁只支持 {VERSION}')
    changes = {}
    early = '.vite/build/early-bootstrap.js'
    old = read_entry(source,header,offset,early).decode('utf-8')
    changes[early] = ("if(process.env.CODEX_USAGE_UI_SELF_TEST==='1'){require('./usage-host.cjs').selfTest()}else{require('./enhancement-loader.cjs').register();\n" + old + '\n}').encode()
    preload = '.vite/build/preload.js'
    changes[preload] = read_entry(source,header,offset,preload) + b'\n;' + (ROOT/'src/enhancement-preload.cjs').read_bytes()
    turn = 'webview/assets/local-conversation-thread-6999d2419a30.js'
    old = read_entry(source,header,offset,turn).decode('utf-8')
    anchor = '"data-content-search-turn-key":H,children:Oe'
    if old.count(anchor) != 1:
        raise RuntimeError('回复组件入口不唯一，已停止构建')
    old=old.replace(anchor,'"data-content-search-turn-key":H,"data-codex-usage-turn":ge,"data-codex-usage-thread":f,children:[Oe,(0,Tk.jsx)(`div`,{"data-codex-usage-turn-slot":!0})]')
    composer_anchor='"data-thread-find-composer":`true`,onMouseDownCapture:me,onFocusCapture:K,children:he'
    if old.count(composer_anchor)!=1:raise RuntimeError('输入框组件入口不唯一，已停止构建')
    old=old.replace(composer_anchor,'"data-thread-find-composer":`true`,onMouseDownCapture:me,onFocusCapture:K,children:[he,(0,LE.jsx)(`div`,{"data-codex-usage-strip-slot":!0})]')
    changes[turn] = old.encode()
    sidebar='webview/assets/app-initial-5851df3f6cb1.js'
    old=read_entry(source,header,offset,sidebar).decode()
    anchor='"data-app-navigation-rail":N,"aria-label":P,children:[F,I,ee,O]'
    if old.count(anchor)!=1:raise RuntimeError('侧栏组件入口不唯一，已停止构建')
    changes[sidebar]=old.replace(anchor,'"data-app-navigation-rail":N,"aria-label":P,children:[F,I,ee,(0,x4.jsx)(`div`,{"data-codex-usage-ring-slot":!0,className:`shrink-0 flex flex-col items-center`}),O]').encode()
    for name in ['usage-data.cjs','usage-host.cjs','usage-preload.cjs','enhancement-loader.cjs','enhancement-preload.cjs']:
        changes['.vite/build/'+name] = (ROOT/'src'/name).read_bytes()
    next_offset = source.stat().st_size-offset
    new_header = copy.deepcopy(header)
    for name, data in changes.items():
        put(new_header,name,{'size':len(data),'offset':str(next_offset),'integrity':integrity(data)})
        next_offset += len(data)
    raw = json.dumps(new_header,ensure_ascii=False,separators=(',',':')).encode()
    padded = raw + b'\0'*((-len(raw)) % 4)
    header_pickle = struct.pack('<II',len(padded)+4,len(raw))+padded
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary = target.with_suffix('.building')
    # 使用独立的新文件，避免对硬链接目标写入，确保原客户端不受影响。
    with temporary.open('wb') as out, source.open('rb') as inp:
        out.write(struct.pack('<II',4,len(header_pickle)))
        out.write(header_pickle)
        inp.seek(offset)
        shutil.copyfileobj(inp,out,1024*1024)
        for data in changes.values(): out.write(data)
    os.replace(temporary,target)
    return {name:hashlib.sha256(data).hexdigest() for name,data in changes.items()}

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

def build(source, destination):
    source = source.resolve(); destination = destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise RuntimeError('输出目录必须独立于原客户端')
    runtime = destination/'app'
    if runtime.exists() and not (destination/'installation.json').exists():
        raise RuntimeError('输出目录中存在未登记的 app，拒绝覆盖')
    original = source/'resources/app.asar'
    before = hashlib.file_digest(original.open('rb'),'sha256').hexdigest()
    print('复制客户端运行时……',flush=True)
    copies = clone_runtime(source,runtime)
    plugin=destination/'plugins/codex-usage'
    (plugin/'lib').mkdir(parents=True,exist_ok=True)
    (plugin/'ui').mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'plugin/plugin.json',plugin/'plugin.json')
    for name in ['usage-data.cjs','usage-host.cjs']:shutil.copy2(ROOT/'src'/name,plugin/'lib'/name)
    shutil.copy2(ROOT/'src/usage-preload.cjs',plugin/'ui/usage-preload.cjs')
    settings=destination/'plugins.json'
    if not settings.exists():settings.write_text(json.dumps({'loaderVersion':1,'plugins':{'codex-usage':{'enabled':True}}},indent=2),encoding='utf-8')
    print('构建定制界面……',flush=True)
    patches = patch_asar(original,runtime/'resources/app.asar')
    # 更新前先从原版重新复制 exe，确保永远不会修改共享硬链接。
    independent = runtime/'ChatGPT.portable-building'
    shutil.copy2(source/'ChatGPT.exe',independent)
    os.replace(independent,runtime/'ChatGPT.exe')
    archive_header_hash = prepare_portable_executable(runtime/'ChatGPT.exe',runtime/'resources/app.asar')
    after = hashlib.file_digest(original.open('rb'),'sha256').hexdigest()
    if before != after: raise RuntimeError('原版文件校验发生变化')
    record = {'version':VERSION,'source':str(source),'destination':str(destination),'originalAsarSha256':before,
              'createdAt':time.strftime('%Y-%m-%d %H:%M:%S'),'patches':patches,'asarHeaderSha256':archive_header_hash,**copies}
    (destination/'installation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    # 启动脚本等待用户手动退出原客户端，不会强制终止当前工作。
    script = r'''$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'app\ChatGPT.exe'
$existing = Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'Codex|CodexUsageUI' }
if ($existing) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('请先从托盘完全退出 Codex，再启动插件加载器。当前任务不会被强制停止。','Codex') | Out-Null
    exit
}
Start-Process -FilePath $runtime -WorkingDirectory (Split-Path $runtime)
'''
    (destination/'Start-CodexUsageUI.ps1').write_text(script,encoding='utf-8-sig')
    restore = r'''$ErrorActionPreference = 'Stop'
$record = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
$existing = Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'Codex|CodexUsageUI' }
if ($existing) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('请先完全退出 Codex。','切回原版') | Out-Null; exit }
Start-Process -FilePath (Join-Path $record.source 'ChatGPT.exe') -WorkingDirectory $record.source
'''
    (destination/'Start-OriginalCodex.ps1').write_text(restore,encoding='utf-8-sig')
    control=r'''param([ValidateSet('Enable','Disable')][string]$Mode='Enable')
$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot 'plugins.json'
$settings=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
$settings.plugins.'codex-usage'.enabled=($Mode -eq 'Enable')
$temporary=$file+'.tmp'
[IO.File]::WriteAllText($temporary,($settings | ConvertTo-Json -Depth 8),([Text.UTF8Encoding]::new($false)))
Move-Item -LiteralPath $temporary -Destination $file -Force
'''
    (destination/'Set-UsagePlugin.ps1').write_text(control,encoding='utf-8-sig')
    for mode in ['Enable','Disable']:
        (destination/(mode+'-UsagePlugin.ps1')).write_text("& (Join-Path $PSScriptRoot 'Set-UsagePlugin.ps1') -Mode "+mode+'\n',encoding='utf-8-sig')
    uninstall=r'''$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Set-UsagePlugin.ps1') -Mode Disable
$base=[IO.Path]::GetFullPath($PSScriptRoot)
$target=[IO.Path]::GetFullPath((Join-Path $base 'plugins\codex-usage'))
$expected=Join-Path $base 'plugins\codex-usage'
if(-not [string]::Equals($target,$expected,[StringComparison]::OrdinalIgnoreCase)){throw '插件目录校验失败'}
if(-not $target.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '插件目录不在加载器内'}
if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
$integration=Join-Path $PSScriptRoot 'shortcut-integration.json'
if(Test-Path -LiteralPath $integration){
 $original=Get-Content -LiteralPath $integration -Raw | ConvertFrom-Json
 if(Test-Path -LiteralPath $original.backup){Copy-Item -LiteralPath $original.backup -Destination $original.path -Force}
}
'''
    (destination/'Uninstall-UsagePlugin.ps1').write_text(uninstall,encoding='utf-8-sig')
    shortcuts=r'''$ErrorActionPreference='Stop'
$base=$PSScriptRoot
$desktop=[Environment]::GetFolderPath('Desktop')
$controls=Join-Path $desktop 'Codex用量插件'
New-Item -ItemType Directory -Path $controls -Force | Out-Null
$shell=New-Object -ComObject WScript.Shell
$items=@(
 @{Name='启用用量插件';Script='Enable-UsagePlugin.ps1';Directory=$controls},
 @{Name='停用用量插件';Script='Disable-UsagePlugin.ps1';Directory=$controls},
 @{Name='卸载用量插件';Script='Uninstall-UsagePlugin.ps1';Directory=$controls}
)
foreach($item in $items){
 $link=$shell.CreateShortcut((Join-Path $item.Directory ($item.Name+'.lnk')))
 $link.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $link.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $base $item.Script)+'"'
 $link.WorkingDirectory=$base
 $link.IconLocation=Join-Path $base 'app\resources\chatgpt-app-dark.ico'
 $link.Description=$item.Name
 $link.Save()
}
'''
    (destination/'Create-Shortcuts.ps1').write_text(shortcuts,encoding='utf-8-sig')
    print(json.dumps(record,ensure_ascii=False,indent=2),flush=True)
    return record

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path)
    parser.add_argument('--destination',type=Path,default=DEFAULT)
    args=parser.parse_args()
    build(args.source or find_source(),args.destination)

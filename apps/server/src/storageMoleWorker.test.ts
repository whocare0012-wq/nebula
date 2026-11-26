// @effect-diagnostics nodeBuiltinImport:off - Python functions run with an in-memory filesystem adapter only.
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { STORAGE_ARCHIVE_PROGRAM } from "./storageArchiveProgram.ts";

// The Python archive worker runs only on macOS; Windows hosts use the storageMoleWindows worker.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";

it.skipIf(windowsHost)(
  "executes and reconciles cleanup with mocked mutations, rejecting drift, busy paths, low space and cancellation",
  () => {
    const program = String.raw`
import ast,json,sys,copy,types
source=json.load(sys.stdin)
module=ast.parse(source)
names={'cleanup_run','cleanup_reconcile','main'}
code=ast.Module(body=[node for node in module.body if isinstance(node,ast.FunctionDef) and node.name in names],type_ignores=[])
files={};events=[];fail='';active_plan=None
class P:
 def __init__(self,s):self.s=str(s)
 def __str__(self):return self.s
 def __eq__(self,other):return isinstance(other,P) and self.s==other.s
 def __truediv__(self,n):return P(self.s+'/'+str(n))
 @property
 def name(self):return self.s.rsplit('/',1)[-1]
 @property
 def parent(self):return P(self.s.rsplit('/',1)[0])
 def with_name(self,n):return self.parent/n
 def resolve(self):return self
 def exists(self):return self.s in files
 def is_dir(self):return True
Path=P
base=P('/base');G=1024**3
os=types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda p:str(p) in files))
shutil=types.SimpleNamespace(disk_usage=lambda p:types.SimpleNamespace(free=55*G))
def ident(p):return files[str(p)]['id'] if str(p) in files else [1,1]
def cleanup_candidate():
 if fail=='locked':raise ValueError('locked')
 return {'id':'candidate','destination':plan['cleanupDestination']},P('/source')
def cleanup_snapshot(p):return [],10,'changed' if fail=='drift' else 'digest'
def cleanup_not_open(p):
 if fail=='busy':raise ValueError('busy')
def cleanup_volumes_check(*args):
 events.append('budget')
 if fail=='space':raise ValueError('space')
def cancelled(p):
 if fail=='cancel':raise ValueError('cancel')
def opfile(i):return i
def save(p,value):events.append('save:'+value['phase'])
def rename_exclusive(src,dest):
 assert str(dest) not in files
 files[str(dest)]=files.pop(str(src));events.append('rename')
def retire_tree(p,*args):
 files.pop(str(p));events.append('delete-memory-only')
def process_identity(pid):return 'gone'
exec(compile(code,'worker','exec'),globals())
def fresh(destination='delete-rebuildable'):
 global files,events,plan,fail
 files={'/source':{'id':[1,2]}};events=[];fail=''
 plan={'id':'plan','source':'/source','sourceIdentity':[1,2],'sourceParentIdentity':[1,1],'digest':'digest','cleanupObjectId':'candidate','cleanupDestination':destination,'phase':'planned','destination':'/trash/target','trashParentIdentity':[1,1]}
for failure in ['locked','drift','busy','space','cancel']:
 fresh();fail=failure
 try:cleanup_run(plan);raise AssertionError('accepted '+failure)
 except ValueError:pass
 assert '/source' in files and 'rename' not in events and 'delete-memory-only' not in events
fresh();assert cleanup_run(plan)['phase']=='completed';assert not files;assert events.index('budget')<events.index('delete-memory-only')
fresh('trash');assert cleanup_run(plan)['phase']=='trashed';assert '/trash/target' in files and 'delete-memory-only' not in events
assert cleanup_reconcile(plan)['phase']=='source_restored' and '/source' in files
fresh('trash');cleanup_run(plan);files['/source']={'id':[9,9]}
try:cleanup_reconcile(plan);raise AssertionError('overwrite accepted')
except ValueError:pass
assert files['/source']['id']==[9,9] and '/trash/target' in files
# Existing execute gate is idempotent and respects plan expiry without touching a path.
record={'id':'plan','phase':'completed'};req={'planId':'plan'};action='execute'
load=lambda p,default:record
assert main() is record
record={'id':'plan','phase':'planned','expiresAt':1};time=types.SimpleNamespace(time=lambda:2)
files={};globals()['state']=P('/state')
assert main()['phase']=='failed'
print(json.dumps({'passed':True,'mutations':'in-memory only','cases':10}))
`;
    const output = NodeChildProcess.execFileSync("/usr/bin/python3", ["-c", program], {
      input: JSON.stringify(STORAGE_ARCHIVE_PROGRAM),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({ passed: true, mutations: "in-memory only", cases: 10 });
  },
);

it.skipIf(windowsHost)(
  "requires the newest two cold-backup receipts and integrity before offering an older backup",
  () => {
    const program = String.raw`
import ast,json,sys,tempfile,hashlib,os,types,time
from pathlib import Path as RealPath
source=json.load(sys.stdin);tree=ast.parse(source)
code=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='cleanup_candidate'],type_ignores=[])
root=RealPath(tempfile.mkdtemp(prefix='c60-backup-policy-')).resolve();stage=root/'staging';home=root/'home';home.mkdir()
def Path(s):return RealPath(s)
Path.home=lambda:home
load=lambda p,default:json.loads(p.read_text()) if p.exists() else default
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
calls=[];bad_tar=False
class Subprocess:
 DEVNULL=None;PIPE=None
 def run(self,args,**kwargs):
  calls.append(args);return types.SimpleNamespace(returncode=1 if bad_tar else 0,stderr=b'bad' if bad_tar else b'')
subprocess=Subprocess()
archives=[]
for i in [1,2,3]:
 p=stage/f'c{i}'/'installation'/'cold-backup.tar.zst';p.parent.mkdir(parents=True);p.write_bytes(b'fixture'+bytes([i]));os.utime(p,(i*86400,i*86400));archives.append(p)
 receipt={'archive':str(p),'archiveBytes':p.stat().st_size,'sha256':digest(p),'contentReadbackVerified':True,'restoreVerified':True,'sourceGroupUnchanged':True,'quickCheck':'ok'}
 p.with_name('cold-backup.json').write_text(json.dumps(receipt))
req={'staging':str(stage),'cleanupCandidate':{'path':str(archives[0]),'locked':False,'canRelease':True,'destination':'trash','category':'cold-backups'}}
exec(compile(code,'worker','exec'),globals())
assert cleanup_candidate()[1]==archives[0] and len(calls)==2
req['cleanupCandidate']['path']=str(archives[2])
try:cleanup_candidate();raise AssertionError('newest backup unlocked')
except ValueError:pass
req['cleanupCandidate']['path']=str(archives[0]);bad_tar=True
try:cleanup_candidate();raise AssertionError('broken archive accepted')
except ValueError:pass
bad_tar=False
receipt_path=archives[2].with_name('cold-backup.json');receipt=json.loads(receipt_path.read_text());receipt['restoreVerified']=False;receipt_path.write_text(json.dumps(receipt))
try:cleanup_candidate();raise AssertionError('unverified restore accepted')
except ValueError:pass
receipt['restoreVerified']=True;receipt['sha256']='wrong';receipt_path.write_text(json.dumps(receipt))
try:cleanup_candidate();raise AssertionError('mismatched backup accepted')
except ValueError:pass
assert all(p.exists() for p in archives)
print(json.dumps({'cases':5,'allOriginalsKept':True,'tar':'mocked'}))
`;
    const output = NodeChildProcess.execFileSync("/usr/bin/python3", ["-c", program], {
      input: JSON.stringify(STORAGE_ARCHIVE_PROGRAM),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({ cases: 5, allOriginalsKept: true, tar: "mocked" });
  },
);

it.skipIf(windowsHost)(
  "discovers an external HFS volume even when T3 home is on that volume",
  () => {
    const program = String.raw`
import ast,json,sys,types,hashlib
source=json.load(sys.stdin);tree=ast.parse(source)
code=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='volumes'],type_ignores=[])
class P:
 def __init__(self,s):self.s=str(s)
 def __str__(self):return self.s
 @property
 def name(self):return self.s.rsplit('/',1)[-1]
 def exists(self):return True
 def is_dir(self):return True
 def is_symlink(self):return False
 def stat(self):return types.SimpleNamespace(st_dev=1 if self.s=='/' else 2)
 def iterdir(self):return [P('/Volumes/external')]
Path=P;base=P('/Volumes/external/isolated-home')
ident=lambda p:[p.stat().st_dev,2]
plistlib=types.SimpleNamespace(loads=lambda _:dict(Internal=False,Writable=True,MountPoint='/Volumes/external',FilesystemType='hfs',VolumeUUID='uuid'),InvalidFileException=ValueError)
subprocess=types.SimpleNamespace(check_output=lambda *a,**k:b'',DEVNULL=None,SubprocessError=RuntimeError)
shutil=types.SimpleNamespace(disk_usage=lambda _:types.SimpleNamespace(free=50*1024**3,total=500*1024**3))
exec(compile(code,'worker','exec'),globals())
assert len(volumes())==1
print('passed')
`;
    expect(
      NodeChildProcess.execFileSync("/usr/bin/python3", ["-c", program], {
        input: JSON.stringify(STORAGE_ARCHIVE_PROGRAM),
        encoding: "utf8",
      }).trim(),
    ).toBe("passed");
  },
);

it.skipIf(windowsHost)(
  "rechecks whole-cache roots, superseded receipts and rollback anchors without mutations",
  () => {
    const program = String.raw`
import ast,json,sys,tempfile,hashlib,os,re
from pathlib import Path as RealPath
source=json.load(sys.stdin);tree=ast.parse(source)
code=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='cleanup_candidate'],type_ignores=[])
root=RealPath(tempfile.mkdtemp(prefix='c63-worker-policy-')).resolve();stage=root/'staging';home=root/'home';apps=root/'Applications';home.mkdir();apps.mkdir()
def Path(s):
 s=str(s)
 if s.startswith('/Applications/'):return apps/s.removeprefix('/Applications/')
 return RealPath(s)
Path.home=lambda:home
load=lambda p,default:json.loads(p.read_text()) if p.exists() else default
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
inside=lambda p,r:p!=r and p.is_relative_to(r)
def file(p,data):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
def document(p,data):file(p,json.dumps(data).encode());return {'path':str(p),'sha256':digest(p)}
cache=home/'Library/Caches/Homebrew';file(cache/'item',b'cache')
req={'staging':str(stage),'cleanupCandidate':dict(path=str(cache),locked=False,canRelease=True,destination='delete-rebuildable',rebuildable=True,category='developer-cache')}
exec(compile(code,'worker','exec'),globals());assert cleanup_candidate()[1]==cache
req['cleanupCandidate']['path']=str(cache.parent)
try:cleanup_candidate();raise AssertionError('cache parent allowed')
except ValueError:pass
p=stage/'c41-old'/'candidate';app=p/'T3.app';file(app/'Contents/Resources/app.asar',b'old')
current_app=apps/'T3 Code (Alpha).app/Contents/Resources/app.asar';file(current_app,b'current')
old={'installed':True,'actualAsar':digest(app/'Contents/Resources/app.asar'),'backupLocation':str(p.parent/'installation')}
current={'installed':True,'status':'installed_verified','actualAsar':digest(current_app),'rollbackApp':str(apps/'T3 Code (Alpha).before-C59.app')}
manifest={'candidate':str(app),'candidateAsar':old['actualAsar'],'signatureVerified':True,'allPackedMembersVerified':4}
proof=[document(p.parent/'candidate.json',manifest),document(root/'old-install.json',old),document(root/'current-install.json',current)]
c=dict(path=str(p),locked=False,canRelease=True,destination='trash',category='old-builds',cleanupEvidence=proof);req['cleanupCandidate']=c
assert cleanup_candidate()[1]==p
file(root/'old-install.json',b'{}')
try:cleanup_candidate();raise AssertionError('changed receipt allowed')
except ValueError:pass
document(root/'old-install.json',old)
file(current_app,b'other install')
try:cleanup_candidate();raise AssertionError('current install mismatch allowed')
except ValueError:pass
file(current_app,b'current');file(p.parent/'installation/cold-backup.tar.zst',b'retained')
try:cleanup_candidate();raise AssertionError('retained generation allowed')
except ValueError:pass
for version in [59,62,70,71]:file(apps/f'T3 Code (Alpha).before-C{version}.app'/'payload',b'app')
for version in [59,62,70,71]:
 c=dict(path=str(apps/f'T3 Code (Alpha).before-C{version}.app'),locked=False,canRelease=True,destination='trash',category='rollback-apps');req['cleanupCandidate']=c
 try:cleanup_candidate();raise AssertionError('protected rollback allowed')
 except ValueError:pass
assert cache.exists() and p.exists() and current_app.exists()
print('10 checks; all originals kept')
`;
    expect(
      NodeChildProcess.execFileSync("/usr/bin/python3", ["-c", program], {
        input: JSON.stringify(STORAGE_ARCHIVE_PROGRAM),
        encoding: "utf8",
      }).trim(),
    ).toBe("10 checks; all originals kept");
  },
);

it.skipIf(windowsHost)(
  "rechecks preview capacity, content, identity and occupancy before accepting a cleanup queue",
  () => {
    const program = String.raw`
import ast,json,sys,types
from pathlib import Path
module=ast.parse(json.load(sys.stdin))
code=ast.Module(body=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='recheck_preview'],type_ignores=[])
plan={'type':'mole-cleanup','spacePath':'/source','source':'/source','freeBefore':10000,'sourceBytes':1000,'measuredBytes':1000,'digest':'ok','sourceIdentity':[1,2],'sourceParentIdentity':[1,1],'cleanupObjectId':'x','cleanupDestination':'trash'}
free=10000;measured=1000;digest='ok';busy=False;low=False;exists=True
shutil=types.SimpleNamespace(disk_usage=lambda p:types.SimpleNamespace(free=free))
def cleanup_volumes_check():
 if low:raise ValueError('reserve')
def cleanup_candidate():
 if not exists:raise ValueError('missing')
 return {'id':'x','destination':'trash'},Path('/source')
def cleanup_not_open(p):
 if busy:raise ValueError('busy')
def cleanup_snapshot(p):return [],measured,digest
def ident(p):return [1,2] if str(p)=='/source' else [1,1]
exec(compile(code,'preview','exec'))
recheck_preview(plan)
for key,value in [('free',9899),('free',10101),('measured',1011),('digest','changed'),('busy',True),('low',True),('exists',False)]:
 old=globals()[key];globals()[key]=value
 try:recheck_preview(plan);raise AssertionError('accepted '+key)
 except ValueError:pass
 globals()[key]=old
print('passed')
`;
    expect(
      NodeChildProcess.execFileSync("/usr/bin/python3", ["-c", program], {
        input: JSON.stringify(STORAGE_ARCHIVE_PROGRAM),
        encoding: "utf8",
      }).trim(),
    ).toBe("passed");
  },
);

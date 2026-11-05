#!/usr/bin/env bash
# Exporta somente fontes conhecidas. Não altera .git nem serviços da aplicação.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export_root="$(mktemp -d "$project_root/reports/github-export-XXXXXXXX")"
python3 - "$project_root" "$export_root" <<'PY'
from pathlib import Path
import json,re,shutil,sys
root,out=map(Path,sys.argv[1:])
folders=['frontend','backend/src','backend/scripts','backend/test','backend/integration','backend/test-support','database','scripts','docs','deploy/systemd']
fixed=['README.md','.gitignore','.dockerignore','Dockerfile','backend/package.json','backend/package-lock.json','backend/server.js','backend/.env.example','docker.env.example','deploy/public-edge/Caddyfile']
files=[root/f for f in fixed]+sorted(root.glob('compose*.yml'))+sorted(root.glob('docker-compose*.yml'))
files += [p for folder in folders for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
patterns=[r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})',r'\bAIza[\w-]{30,}']
blocked=[];copied=[]
for source in sorted(set(files)):
 relative=source.relative_to(root)
 if source.is_symlink():raise SystemExit('Exportação recusada: link simbólico em '+str(relative))
 if any(x in relative.parts for x in ['node_modules','.git','.aws','.agents','.codex','.ssh','__pycache__']):continue
 if source.suffix.lower() in ['.pem','.key','.p12','.pfx','.pyc','.log','.gz','.zip','.dump']:continue
 if source.name.startswith('.env') and source.name!='.env.example':continue
 if source.name=='rclone.conf' or source.name.startswith(('client_secret','service-account')):continue
 data=source.read_bytes()
 text=data.decode('utf-8',errors='replace')
 if any(re.search(pattern,text) for pattern in patterns):blocked.append(str(relative));continue
 target=out/'project'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);copied.append(str(relative))
if blocked:
 shutil.rmtree(out/'project')
 raise SystemExit('Possíveis credenciais; exportação recusada nos arquivos: '+', '.join(blocked))
(out/'manifest.json').write_text(json.dumps({'files':copied,'count':len(copied),'production_state_included':False},indent=2)+'\n')
print('EXPORTAÇÃO PREPARADA: '+str(out/'project'))
print('Arquivos: '+str(len(copied)))
PY

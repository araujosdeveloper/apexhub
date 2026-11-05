"""Fases de atualização com Docker/rede simulados; nenhum acesso ao host real."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root=Path(os.environ['UPDATE_TEST_ROOT']); args=sys.argv[1:]; scenario=os.environ['UPDATE_TEST_SCENARIO']
with (root/'calls.jsonl').open('a') as output: output.write(json.dumps({'args':args,'image':os.environ.get('DELIVERY_UPDATE_IMAGE','')})+'\n')
if args[:1]==['info']: sys.exit(2 if scenario=='blocked' else 0)
if args[:1]==['inspect']:
 print('false' if '.State.Running' in args[2] else 'sha256:'+('a' if args[-1]=='live-app' else 'b')*64)
elif args[:2]==['container','inspect']: sys.exit(0 if (root/'temporary-container').exists() else 1)
elif args[:2]==['network','inspect']: sys.exit(0 if (root/'temporary-network').exists() else 1)
elif args[:2]==['network','create']: (root/'temporary-network').touch();print('network')
elif args[:2]==['network','rm']: (root/'temporary-network').unlink(missing_ok=True)
elif args[:1]==['rm']: (root/'temporary-container').unlink(missing_ok=True)
elif args[:1]==['run']:
 if '--detach' in args: (root/'temporary-container').touch();print('temporary-mysql')
 if '--rehearse' in args and scenario=='rehearsal_failure': sys.exit(13)
elif args[:1]==['compose']:
 if '--apply' in args and scenario=='migration_failure': sys.exit(17)
 if '--canary' in args and scenario=='canary_failure': sys.exit(18)
 if 'validate' in args and scenario=='route_failure': sys.exit(19)
 if 'up' in args:
  (root/'started-new').touch()
  if scenario=='app_failure' and os.environ.get('DELIVERY_UPDATE_IMAGE','').startswith('delivery-saas-update:'): sys.exit(20)
sys.exit(0)
'''
MANAGE = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['UPDATE_TEST_ROOT']);args=sys.argv[1:]
with (root/'calls.jsonl').open('a') as output: output.write(json.dumps({'args':['manage']+args})+'\n')
if args[:2]==['ps','-q']: print('live-'+args[2])
elif args[:1]==['config']: print('{"name":"delivery-live-fixture","services":{"app":{}}}')
'''
CURL = r'''#!/usr/bin/env python3
import os,sys
from pathlib import Path
root=Path(os.environ['UPDATE_TEST_ROOT']);args=sys.argv[1:];scenario=os.environ['UPDATE_TEST_SCENARIO']
maintenance='@delivery_update_block' in (root/'deploy/public-edge/routes/active.caddy').read_text()
if '--write-out' in args: print('200' if scenario=='maintenance_failure' else '503',end='')
elif scenario=='public_failure' and (root/'started-new').exists() and not maintenance: sys.exit(22)
elif '/api/menu/' in args[-1]: print('{"operations":{},"products":[]}')
else: print('{"status":"ok"}')
'''
BACKUP = r'''#!/usr/bin/env bash
set -Eeuo pipefail
root="$UPDATE_TEST_ROOT"
count=0
if [[ -f "$root/backup-counter" ]]; then count="$(cat "$root/backup-counter")"; fi
count=$((count+1))
printf '%s' "$count" > "$root/backup-counter"
if [[ "$count" == 2 && "$UPDATE_TEST_SCENARIO" == backup_failure ]]; then exit 7; fi
directory="$root/backups/live/live-fixture-$count"
mkdir -p "$directory"
printf 'SELECT 1;\n' | gzip > "$directory/backup.sql.gz"
printf '{"source_server_uuid":"11111111-1111-1111-1111-111111111111"}\n' > "$directory/manifest.json"
(cd "$directory" && sha256sum backup.sql.gz manifest.json > SHA256SUMS)
printf 'BACKUP CONCLUÍDO: %s\n' "$directory"
'''


class LiveUpdate(unittest.TestCase):
    def run_scenario(self, scenario):
        with tempfile.TemporaryDirectory(prefix='delivery-update-test-') as directory:
            root = Path(directory)
            for name in ['scripts','bin','backups/live','deploy/public-edge/routes','reports/release-20261103T025846Z-321081']:
                (root/name).mkdir(parents=True)
            for name in ['update-live.sh','live-backup-common.sh']:
                shutil.copy(ROOT/'scripts'/name, root/'scripts'/name)
            (root/'scripts/backup-live.sh').write_text(BACKUP)
            (root/'scripts/validate-mysql.sh').write_text('#!/bin/sh\nexit 0\n')
            release=root/'reports/release-20261103T025846Z-321081'
            (release/'manage.sh').write_text('#!/bin/sh\nexec python3 "$UPDATE_TEST_ROOT/mock-manage.py" "$@"\n')
            (release/'STATUS.txt').write_text('PUBLICADO\n')
            (root/'deploy/live-release.path').write_text(str(release)+'\n')
            (root/'deploy/public-edge/Caddyfile').write_text('fixture\n')
            route=root/'deploy/public-edge/routes/active.caddy'
            original='handle { reverse_proxy delivery-app-20261103t025846z-321081:3000 }\n'
            route.write_text(original)
            (root/'mock-manage.py').write_text(MANAGE)
            for name,source in [('docker',DOCKER),('curl',CURL)]:
                script=root/'bin'/name;script.write_text(source);script.chmod(0o700)
            env=dict(os.environ,PATH=str(root/'bin')+':'+os.environ['PATH'],UPDATE_TEST_ROOT=str(root),UPDATE_TEST_SCENARIO=scenario)
            result=subprocess.run(['bash',str(root/'scripts/update-live.sh')],env=env,capture_output=True,text=True,timeout=25)
            calls=[json.loads(line) for line in (root/'calls.jsonl').read_text().splitlines()]
            reports=list((root/'reports').glob('update-*'))
            status=(reports[0]/'STATUS.txt').read_text().strip() if reports else None
            return result,calls,status,route.read_text(),original,(root/'temporary-container').exists(),(root/'temporary-network').exists()

    def test_blocked_docker_never_changes_route_or_stops_application(self):
        result,calls,status,route,original,*_=self.run_scenario('blocked')
        self.assertNotEqual(result.returncode,0);self.assertEqual(route,original);self.assertIsNone(status)
        self.assertEqual(len(calls),1)

    def test_failed_rehearsal_or_route_validation_does_not_stop_live_app(self):
        for scenario in ['rehearsal_failure','route_failure']:
            with self.subTest(scenario=scenario):
                result,calls,status,route,original,container,network=self.run_scenario(scenario)
                self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertEqual(route,original);self.assertEqual(status,'FALHOU_ANTES_DA_MANUTENCAO')
                self.assertFalse(any('stop' in call['args'] for call in calls));self.assertFalse(container);self.assertFalse(network)

    def test_unconfirmed_maintenance_cannot_stop_or_migrate_live_app(self):
        result,calls,status,route,original,*_=self.run_scenario('maintenance_failure')
        self.assertNotEqual(result.returncode,0);self.assertEqual(route,original)
        self.assertFalse(any('stop' in call['args'] or '--apply' in call['args'] for call in calls))

    def test_failure_before_open_restores_old_image_and_never_restores_database_backup(self):
        for scenario in ['backup_failure','migration_failure','canary_failure','app_failure']:
            with self.subTest(scenario=scenario):
                result,calls,status,route,original,*_=self.run_scenario(scenario)
                self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertEqual(status,'RETORNOU_VERSAO_ANTERIOR');self.assertEqual(route,original)
                restored=[call for call in calls if 'up' in call['args'] and call.get('image','').startswith('delivery-saas-rollback:')]
                self.assertEqual(len(restored),1)
                self.assertFalse(any('saas_mysql' in ' '.join(call['args']) for call in calls))

    def test_failure_after_open_does_not_rollback_potential_new_orders(self):
        result,calls,status,route,original,*_=self.run_scenario('public_failure')
        self.assertNotEqual(result.returncode,0);self.assertEqual(status,'VERIFICAR');self.assertEqual(route,original)
        self.assertFalse(any('up' in call['args'] and call.get('image','').startswith('delivery-saas-rollback:') for call in calls))

    def test_success_promotes_image_keeps_database_and_cleans_temporary_services(self):
        result,calls,status,route,original,container,network=self.run_scenario('success')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertEqual(status,'PUBLICADO');self.assertEqual(route,original)
        self.assertIn('ATUALIZAÇÃO PUBLICADA',result.stdout);self.assertFalse(container);self.assertFalse(network)
        self.assertTrue(any('--apply' in call['args'] for call in calls))
        self.assertTrue(any(call['args'][:2]==['image','tag'] and call['args'][-1]=='delivery-live-fixture-app' and call['args'][2].startswith('delivery-saas-update:') for call in calls))
        self.assertFalse(any('down' in call['args'] or 'saas_mysql' in ' '.join(call['args']) for call in calls))


if __name__=='__main__': unittest.main()

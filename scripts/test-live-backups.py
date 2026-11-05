"""Testes de backup/restauração com Docker simulado e filesystem temporário."""
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
args=sys.argv[1:]
root=Path(os.environ['BACKUP_TEST_ROOT'])
with (root/'calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\n')
if args[:1]==['inspect']: print('sha256:'+'a'*64)
elif args[:1]==['run']: (root/'container-created').write_text('yes');print('mock-container')
elif args[:2]==['container','inspect']: sys.exit(0 if (root/'container-created').exists() else 1)
elif args[:1]==['rm']: (root/'container-created').unlink(missing_ok=True)
elif args[:1]==['exec']:
    text=' '.join(args)
    if 'mysqlcheck' in text: sys.exit(127)
    elif 'information_schema.TABLES' in text: print('12')
    elif 'SELECT 1' in text: print('1')
    else:
        sql=sys.stdin.read()
        if sql.startswith('SELECT TABLE_NAME'):
            for i in range(12): print('table_'+str(i))
        elif sql.startswith('CHECK TABLE'):
            for i in range(12):
                status='error\tCorrupt' if os.environ.get('BACKUP_TEST_CORRUPT_TABLE')=='1' and i==0 else 'status\tOK'
                print('delivery_restore_test.table_'+str(i)+'\tcheck\t'+status)
sys.exit(0)
'''
MANAGE = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:];root=Path(os.environ['BACKUP_TEST_ROOT'])
with (root/'calls.jsonl').open('a') as f:f.write(json.dumps(['manage']+args)+'\n')
text=' '.join(args)
if args[:2]==['ps','-q']: print('mock-live-mysql')
elif 'mysqldump' in text:
    if os.environ.get('BACKUP_TEST_FAIL_DUMP')=='1': sys.exit(7)
    print('CREATE TABLE fixture (id INT);')
else:
    sql=sys.stdin.read()
    if "ENGINE <> 'InnoDB'" in sql: print('0')
    elif 'SELECT DATABASE()' in sql: print('delivery_live_db\t11111111-1111-1111-1111-111111111111\t8.0.46\t12')
    else: sys.exit(8)
'''


class BackupFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='delivery-backup-test-')
        self.root = Path(self.tmp.name)
        for directory in ['scripts', 'backend/src', 'backend/scripts', 'deploy/public-edge/routes', 'reports/release-20261103T025846Z-321081', 'bin']:
            (self.root/directory).mkdir(parents=True)
        for name in ['live-backup-common.sh', 'backup-live.sh', 'verify-live-backup.sh']:
            shutil.copy(ROOT/'scripts'/name, self.root/'scripts'/name)
        shutil.copy(ROOT/'backend/src/backup-retention.js', self.root/'backend/src')
        shutil.copy(ROOT/'backend/src/restore-check.js', self.root/'backend/src')
        shutil.copy(ROOT/'backend/scripts/check-restored-tables.js', self.root/'backend/scripts')
        release = self.root/'reports/release-20261103T025846Z-321081'
        (release/'STATUS.txt').write_text('PUBLICADO\n')
        (release/'manage.sh').write_text('#!/usr/bin/env bash\nexec python3 "$(dirname "$0")/mock-manage.py" "$@"\n')
        (release/'mock-manage.py').write_text(MANAGE)
        (self.root/'deploy/public-edge/routes/active.caddy').write_text('reverse_proxy delivery-app-20261103t025846z-321081:3000\n')
        (self.root/'deploy/live-release.path').write_text(str(release)+'\n')
        (self.root/'bin/docker').write_text(DOCKER)
        (self.root/'bin/docker').chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.root/'bin')+':'+os.environ['PATH'], BACKUP_TEST_ROOT=str(self.root))

    def tearDown(self): self.tmp.cleanup()

    def run_script(self, name, **overrides):
        return subprocess.run(['bash',str(self.root/'scripts'/name)],env=dict(self.env,**overrides),capture_output=True,text=True,timeout=20)

    def test_backup_restore_and_cleanup_are_isolated(self):
        backup=self.run_script('backup-live.sh')
        self.assertEqual(backup.returncode,0,backup.stderr)
        directory=(self.root/'backups/live/latest').resolve()
        self.assertEqual(directory.stat().st_mode & 0o777,0o700)
        self.assertEqual((directory/'backup.sql.gz').stat().st_mode & 0o777,0o600)
        manifest=json.loads((directory/'manifest.json').read_text())
        self.assertEqual(manifest['database'],'delivery_live_db')
        restored=self.run_script('verify-live-backup.sh')
        self.assertEqual(restored.returncode,0,restored.stdout+restored.stderr)
        self.assertEqual(json.loads((directory/'restore-check.json').read_text())['status'],'RESTORE_PASSED')
        self.assertFalse((self.root/'container-created').exists())
        calls=[json.loads(line) for line in (self.root/'calls.jsonl').read_text().splitlines()]
        run=next(args for args in calls if args[0]=='run')
        self.assertEqual(run[run.index('--network')+1],'none')
        self.assertIn('--skip-networking',run)
        self.assertNotIn('-p',run)
        self.assertFalse(any('saas_mysql' in ' '.join(args) for args in calls))

    def test_check_table_error_prevents_restore_approval_and_cleans_container(self):
        self.assertEqual(self.run_script('backup-live.sh').returncode,0)
        result=self.run_script('verify-live-backup.sh', BACKUP_TEST_CORRUPT_TABLE='1')
        self.assertNotEqual(result.returncode,0)
        directory=(self.root/'backups/live/latest').resolve()
        self.assertFalse((directory/'restore-check.json').exists())
        self.assertFalse((self.root/'container-created').exists())

    def test_stale_release_pointer_is_rejected_before_querying_database(self):
        (self.root/'deploy/public-edge/routes/active.caddy').write_text('reverse_proxy another-release:3000\n')
        result=self.run_script('backup-live.sh')
        self.assertNotEqual(result.returncode,0)
        calls=[json.loads(line) for line in (self.root/'calls.jsonl').read_text().splitlines()]
        self.assertFalse(any(args[0]=='manage' for args in calls))

    def test_failed_dump_never_publishes_an_incomplete_backup(self):
        result=self.run_script('backup-live.sh',BACKUP_TEST_FAIL_DUMP='1')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.root/'backups/live/latest').exists())
        self.assertFalse(list((self.root/'backups/live').glob('.partial-*')))

    def test_corrupted_backup_is_rejected_before_restore(self):
        self.assertEqual(self.run_script('backup-live.sh').returncode,0)
        directory=(self.root/'backups/live/latest').resolve()
        (directory/'backup.sql.gz').write_text('corrupted')
        result=self.run_script('verify-live-backup.sh')
        self.assertNotEqual(result.returncode,0)
        calls=[json.loads(line) for line in (self.root/'calls.jsonl').read_text().splitlines()]
        self.assertFalse(any(args[0]=='run' for args in calls))


if __name__=='__main__': unittest.main()

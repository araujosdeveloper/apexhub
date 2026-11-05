"""Testa fases de recuperação sem Docker, rede ou banco reais."""
import errno
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent

DOCKER = r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
args = sys.argv[1:]
scenario = os.environ['DEPLOY_TEST_SCENARIO']
log = Path(os.environ['DEPLOY_TEST_LOG'])
if args[:3] == ['exec', '-i', 'saas_mysql']:
    sql = sys.stdin.read()
    with log.open('a') as f: f.write(sql + '\n')
    if 'SCHEMATA' in sql or 'read_only +' in sql or 'persisted_variables' in sql: print('0')
    elif 'SELECT @@server_uuid' in sql: print('11111111-1111-1111-1111-111111111111')
    elif 'SELECT @@global.super_read_only' in sql: print('1')
    elif "COUNT(*) FROM categories" in sql:
        for name in ['categories','companies','customers','option_groups','options','order_items','orders','products']: print(name + '\t0')
    sys.exit(0)
if 'compose' in args:
    if 'exec' in args and 'mysql' in args: print('22222222-2222-2222-2222-222222222222')
    if 'caddy' in args and 'validate' in args and scenario == 'before_publish': sys.exit(4)
    if 'caddy' in args and 'reload' in args:
        with log.open('a') as f: f.write('PUBLIC_RELOAD\n')
        if scenario == 'after_publish': sys.exit(5)
sys.exit(0)
'''

BACKUP = r'''#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$DEPLOY_TEST_SCENARIO" == after_freeze ]]; then exit 9; fi
root="$(cd "$(dirname "$0")/.." && pwd)"
backup="$root/backups/legacy-fixture"
mkdir -p "$backup"
printf 'fixture only\n' | gzip > "$backup/backup.sql.gz"
printf 'fixture\n' > "$backup/STATUS.txt"
(cd "$backup" && sha256sum backup.sql.gz > SHA256SUMS)
printf 'Pasta privada: %s\n' "$backup"
'''


class PublicationRecovery(unittest.TestCase):
    def run_scenario(self, scenario):
        with tempfile.TemporaryDirectory(prefix='delivery-deploy-test-') as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'bin').mkdir()
            (root / 'deploy/public-edge/routes').mkdir(parents=True)
            shutil.copy(ROOT / 'scripts/publish-release.sh', root / 'scripts')
            (root / 'deploy/public-edge/Caddyfile').write_text('fixture only\n')
            route = root / 'deploy/public-edge/routes/active.caddy'
            route.write_text('respond "A loja está sendo preparada" 503\n')
            (root / 'scripts/inventory-legacy.sh').write_text(BACKUP)
            for name, contents in [('docker', DOCKER), ('curl', '#!/bin/sh\ncase "$*" in *deployment-health*) echo delivery-https-ready;; *) echo \'{"status":"ok"}\';; esac\n')]:
                file = root / 'bin' / name
                file.write_text(contents)
                file.chmod(0o700)
            log = root / 'queries.log'
            env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'], DEPLOY_TEST_SCENARIO=scenario, DEPLOY_TEST_LOG=str(log))
            # Nenhum comando Docker real é acessível: todos passam pelo executável simulado.
            master, slave = pty.openpty()
            process = subprocess.Popen(['bash', str(root / 'scripts/publish-release.sh')], stdin=slave, stdout=slave, stderr=slave, env=env)
            os.close(slave)
            output = bytearray()
            deadline = time.monotonic() + 20
            try:
                while time.monotonic() < deadline:
                    if select.select([master], [], [], 0.1)[0]:
                        try:
                            chunk = os.read(master, 65536)
                        except OSError as exc:
                            if exc.errno == errno.EIO: break
                            raise
                        if not chunk: break
                        output.extend(chunk)
                    elif process.poll() is not None: break
                result = process.wait(timeout=1)
            finally:
                if process.poll() is None: process.kill(); process.wait()
                os.close(master)
            return result, log.read_text(), route.read_text(), output.decode(errors='replace')

    def test_failure_during_backup_reopens_original_writes(self):
        code, queries, route, output = self.run_scenario('after_freeze')
        self.assertEqual(code, 9, output)
        self.assertIn('SET GLOBAL super_read_only=ON', queries)
        self.assertIn('SET GLOBAL super_read_only=OFF', queries)
        self.assertNotIn('PUBLIC_RELOAD', queries)
        self.assertNotIn('reverse_proxy', route)

    def test_failure_validating_route_restores_persistent_flags(self):
        code, queries, route, output = self.run_scenario('before_publish')
        self.assertEqual(code, 4, output)
        self.assertIn('SET PERSIST super_read_only=ON', queries)
        self.assertIn('RESET PERSIST IF EXISTS super_read_only', queries)
        self.assertIn('SET GLOBAL read_only=OFF', queries)
        self.assertNotIn('reverse_proxy', route)

    def test_failure_after_route_change_never_reopens_old_database(self):
        code, queries, route, output = self.run_scenario('after_publish')
        self.assertEqual(code, 5, output)
        self.assertIn('PUBLIC_RELOAD', queries)
        self.assertIn('reverse_proxy', route)
        self.assertNotIn('super_read_only=OFF', queries)
        self.assertIn('Não reabrir gravações', output)

    def test_success_keeps_old_database_read_only(self):
        code, queries, route, output = self.run_scenario('success')
        self.assertEqual(code, 0, output)
        self.assertIn('LOJA PUBLICADA', output)
        self.assertIn('reverse_proxy', route)
        self.assertNotIn('super_read_only=OFF', queries)


if __name__ == '__main__':
    unittest.main()

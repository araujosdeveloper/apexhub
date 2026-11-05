"""Verifica o terminal real por PTY, com Docker e banco simulados, sem dados reais."""
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent


class MasterCli(unittest.TestCase):
    def scenario(self, password='Teste-cli-master-12345', confirmation=None, cancel=False):
        with tempfile.TemporaryDirectory(prefix='apex-master-cli-') as temporary:
            root = Path(temporary)
            for folder in ['scripts', 'bin', 'deploy/public-edge/routes', 'reports/release-20261103T025846Z-321081']:
                (root/folder).mkdir(parents=True)
            for name in ['create-master.sh', 'live-backup-common.sh']:
                shutil.copy(ROOT/'scripts'/name, root/'scripts'/name)
            release = root/'reports/release-20261103T025846Z-321081'
            (root/'deploy/live-release.path').write_text(str(release)+'\n')
            (release/'STATUS.txt').write_text('PUBLICADO\n')
            (root/'deploy/public-edge/routes/active.caddy').write_text('reverse_proxy delivery-app-20261103t025846z-321081:3000\n')
            docker = root/'bin/docker'
            docker.write_text('#!/bin/sh\nexit 0\n')
            docker.chmod(0o700)
            (release/'manage.sh').write_text('''#!/usr/bin/env bash
set -eu
[[ "$1" == exec && "$2" == -T && "$3" == app ]] || exit 3
node -e 'let data="";process.stdin.on("data",c=>data+=c);process.stdin.on("end",()=>{if(!data)return;const input=JSON.parse(data);if(input.name!=="Admin teste"||input.email!=="admin@example.com"||input.password.length<16)process.exit(3);require("node:fs").writeFileSync(process.env.CLI_TEST_MARKER,"created");console.log("Conta Master criada. ID: 99");});'
''')
            env = dict(os.environ, PATH=str(root/'bin')+':'+os.environ['PATH'], CLI_TEST_MARKER=str(root/'created'))
            master, slave = pty.openpty()
            proc = subprocess.Popen(['bash', str(root/'scripts/create-master.sh')], stdin=slave, stdout=slave, stderr=slave, env=env)
            os.close(slave)
            output = bytearray()
            def until(text):
                deadline = time.monotonic()+8
                while text.encode() not in output:
                    if time.monotonic()>deadline:
                        self.fail('Prompt não apareceu ou terminal travou: '+text)
                    if select.select([master], [], [], .1)[0]:
                        try:
                            chunk = os.read(master, 4096)
                        except OSError:
                            self.fail('Terminal encerrou antes do prompt: '+text)
                        if not chunk:
                            self.fail('Entrada encerrada antes do prompt: '+text)
                        output.extend(chunk)
            try:
                until('Nome do administrador Master:')
                os.write(master, b'Admin teste\n')
                until('E-mail Master:')
                os.write(master, b'admin@example.com\n')
                until('pressione Enter ao terminar):')
                if cancel:
                    proc.send_signal(signal.SIGINT)
                else:
                    os.write(master, password.encode()+b'\n')
                    until('Repita a senha')
                    os.write(master, (confirmation if confirmation is not None else password).encode()+b'\n')
                proc.wait(timeout=8)
                while select.select([master], [], [], .1)[0]:
                    try:
                        chunk = os.read(master, 4096)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output.extend(chunk)
                decoded = output.decode(errors='replace')
                self.assertNotIn(password, decoded)
                return proc.returncode, decoded, (root/'created').exists()
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                os.close(master)

    def test_interactive_input_no_docker_tty_and_no_password_echo(self):
        code, output, created = self.scenario()
        self.assertEqual(code, 0)
        self.assertTrue(created)
        self.assertIn('Conta Master criada. ID: 99', output)

    def test_mismatched_passwords_never_reach_database(self):
        code, output, created = self.scenario(confirmation='Outra-senha-1234567')
        self.assertEqual(code, 2)
        self.assertFalse(created)
        self.assertIn('As senhas não coincidem', output)

    def test_short_password_rejected_without_creation(self):
        code, output, created = self.scenario(password='curta')
        self.assertEqual(code, 2)
        self.assertFalse(created)
        self.assertNotIn('Acesse:', output)

    def test_cancel_does_not_create_account(self):
        code, output, created = self.scenario(cancel=True)
        self.assertEqual(code, 130)
        self.assertFalse(created)
        self.assertIn('Criação cancelada', output)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Read-only production checks. No credentials or database writes."""
import datetime as dt
import json
import os
from pathlib import Path
import socket
import ssl
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HOST = '179.198.120.188'


def fresh(value, now, hours=36):
    timestamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    age = (now - timestamp).total_seconds()
    if not -300 <= age <= hours * 3600:
        raise ValueError('Data ausente, futura ou mais antiga que %s horas' % hours)


def backup_checks(root, now):
    manifest = json.loads((root / 'backups/live/latest/manifest.json').read_text())
    if manifest.get('status') != 'BACKUP_COMPLETE' or manifest.get('database') != 'delivery_live_db':
        raise ValueError('Backup local sem confirmação de conclusão')
    fresh(manifest['created_at'], now)
    receipt = json.loads((root / 'backups/drive-private/last-upload.json').read_text())
    if receipt.get('status') != 'DRIVE_UPLOAD_VERIFIED':
        raise ValueError('Envio ao Drive sem confirmação')
    fresh(receipt['verified_at'], now)
    # A new verification of an old backup must not hide stale data.
    remote_manifest = root / 'backups/live' / receipt['backup'] / 'manifest.json'
    if remote_manifest.parent.parent != root / 'backups/live':
        raise ValueError('Identificador de backup inválido')
    uploaded = json.loads(remote_manifest.read_text())
    if uploaded.get('status') != 'BACKUP_COMPLETE' or uploaded.get('database') != 'delivery_live_db':
        raise ValueError('Manifesto do backup enviado inválido')
    fresh(uploaded['created_at'], now)


def https_checks(now):
    context = ssl.create_default_context()
    with socket.create_connection((HOST, 443), timeout=15) as raw:
        with context.wrap_socket(raw, server_hostname=HOST) as tls:
            expires = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])
    if expires - now.timestamp() < 24 * 3600:
        raise ValueError('Certificado HTTPS vence em menos de 24 horas')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('https://' + HOST + '/api/health', timeout=15) as response:
        if response.url != 'https://' + HOST + '/api/health' or response.status != 200:
            raise ValueError('Resposta inesperada da API')
        if json.loads(response.read(4096)).get('status') != 'ok':
            raise ValueError('API não confirmou disponibilidade do banco')


def main():
    os.umask(0o077)
    now = dt.datetime.now(dt.timezone.utc)
    checks = {}
    for name, check in [('https_api', lambda: https_checks(now)),
                        ('backups_local_drive', lambda: backup_checks(ROOT, now))]:
        try:
            check()
            checks[name] = {'ok': True}
        except Exception as error:
            checks[name] = {'ok': False, 'error': str(error)}
    result = {'checked_at': now.isoformat(), 'ok': all(c['ok'] for c in checks.values()), 'checks': checks}
    directory = ROOT / 'reports/monitoring'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = directory / 'latest.json.next'
    temporary.write_text(json.dumps(result, indent=2) + '\n')
    temporary.replace(directory / 'latest.json')
    print(json.dumps(result, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())

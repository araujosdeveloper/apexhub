"""Fluxo de envio sem OAuth, rede ou dados reais."""
import json
import shutil
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('live_backup_fixture',Path(__file__).with_name('test-live-backups.py'))
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
BackupFlow,ROOT=fixture.BackupFlow,fixture.ROOT


class DriveFlow(BackupFlow):
    def setUp(self):
        super().setUp()
        shutil.copy(ROOT/'scripts/upload-drive-backup.sh',self.root/'scripts')
        shutil.copy(ROOT/'backend/src/drive-config.js',self.root/'backend/src')
        private=self.root/'backups/drive-private';private.mkdir(parents=True)
        (private/'rclone.conf').write_text('[delivery_drive]\ntype = drive\nscope = drive.file\nclient_id = 1234-bebella.apps.googleusercontent.com\nclient_secret = example-secret\ntoken = {"access_token":"dummy","refresh_token":"dummy"}\n[delivery_crypt]\ntype = crypt\nremote = delivery_drive:Delivery-SaaS-Backups\nfilename_encryption = standard\ndirectory_name_encryption = true\npassword = dummy-key\npassword2 = dummy-salt\n')
        (self.root/'scripts/drive-rclone.sh').write_text('''#!/usr/bin/env bash
exec python3 "$(dirname "$0")/mock-drive.py" "$@"
''')
        (self.root/'scripts/mock-drive.py').write_text('''import os,sys,json
from pathlib import Path
args=sys.argv[1:];root=Path(os.environ['BACKUP_TEST_ROOT'])
with (root/'calls.jsonl').open('a') as file:file.write(json.dumps(['rclone']+args)+'\\n')
if not args[2].startswith('delivery_crypt:'):sys.exit(12)
if args[0]=='check' and os.environ.get('DRIVE_TEST_FAIL_CHECK')=='1':sys.exit(9)
''')

    def test_upload_uses_only_encrypted_remote_and_verifies_download(self):
        self.assertEqual(self.run_script('backup-live.sh').returncode,0)
        result=self.run_script('upload-drive-backup.sh')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        receipt=json.loads((self.root/'backups/drive-private/last-upload.json').read_text())
        self.assertEqual(receipt['status'],'DRIVE_UPLOAD_VERIFIED')
        calls=[json.loads(line) for line in (self.root/'calls.jsonl').read_text().splitlines()]
        transfers=[args for args in calls if args[0]=='rclone']
        self.assertEqual([args[1] for args in transfers],['copy','check'])
        self.assertIn('--download',transfers[1])
        self.assertTrue(all(args[3].startswith('delivery_crypt:') for args in transfers))

    def test_failed_roundtrip_does_not_record_success(self):
        self.assertEqual(self.run_script('backup-live.sh').returncode,0)
        result=self.run_script('upload-drive-backup.sh',DRIVE_TEST_FAIL_CHECK='1')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.root/'backups/drive-private/last-upload.json').exists())


if __name__=='__main__':
    import unittest
    # Somente casos novos; fluxo local já tem suíte independente.
    suite=unittest.TestSuite(DriveFlow(name) for name in ['test_upload_uses_only_encrypted_remote_and_verifies_download','test_failed_roundtrip_does_not_record_success'])
    result=unittest.TextTestRunner().run(suite)
    raise SystemExit(not result.wasSuccessful())

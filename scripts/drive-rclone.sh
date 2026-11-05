#!/usr/bin/env bash
# Configuração privada; não expõe tokens nem chaves em argumentos.
set +x
set -Eeuo pipefail
umask 077
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
private_dir="$project_root/backups/drive-private"
if [[ ! -f "$private_dir/image-id" || ! -f "$private_dir/rclone.conf" || -L "$private_dir" ]]; then printf 'Configure primeiro a conexão privada com o Drive.\n' >&2; exit 2; fi
IFS= read -r image_id < "$private_dir/image-id"
if [[ ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then printf 'Identidade da imagem rclone inválida.\n' >&2; exit 2; fi
exec docker run --rm --read-only --tmpfs /tmp --user "$(id -u):$(id -g)" --volume "$private_dir:/config/rclone" --volume "$project_root/backups/live:/backups:ro" "$image_id" --config /config/rclone/rclone.conf "$@"

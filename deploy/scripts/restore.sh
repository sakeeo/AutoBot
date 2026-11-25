#!/usr/bin/env bash
# Puts a backup (plain .tar, or .tar.age with AGE_IDENTITY=<file>) back into the volumes. The stack is stopped first.
# No migration is run backwards: a backup is restored to the same or a newer version of the app.
#   ./restore.sh /path/autobot-<stamp>.tar[.age]
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?berkas cadangan}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
case "$FILE" in
  *.age) age -d -i "${AGE_IDENTITY:?AGE_IDENTITY: berkas kunci privat age}" "$FILE" | tar -C "$TMP" -xf - ;;
  *.tar) tar -C "$TMP" -xf "$FILE" ;;
  *) echo "format tidak dikenal" >&2; exit 1 ;;
esac
[ -d "$TMP/worker" ] && [ -d "$TMP/web" ] || { echo "isi cadangan tidak lengkap" >&2; exit 1; }
read -r -p "Ini MENGGANTI data AutoBot yang sekarang. Ketik 'ganti' untuk lanjut: " ok
[ "$ok" = "ganti" ] || { echo "dibatalkan"; exit 1; }
docker compose down
copy() { # <image> <volume> <source folder> <owner>
  docker run --rm --user 0 -v "autobot_$2:/dest" -v "$3:/src:ro" --entrypoint sh "$1" -c \
    "find /dest -mindepth 1 -delete && cp -a /src/. /dest/ && chown -R $4 /dest"
}
docker compose build >/dev/null
copy autobot-worker:"${TAG:-dev}" data "$TMP/worker" 10002:10002
copy autobot-web:"${TAG:-dev}" authdata "$TMP/web" 10001:10001
docker compose up -d
echo "OK dipulihkan"

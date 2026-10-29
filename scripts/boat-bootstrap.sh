#!/bin/sh
set -eu
mkdir -p .mise/boat
if [ ! -x .mise/boat/boat ]; then
  curl -fsSL 'https://boat.dev/api/boat/cli/download?platform=linux-x64&channel=prod' -o .mise/boat/boat.download
  mise exec -- python -c 'import hashlib,pathlib; p=pathlib.Path(".mise/boat/boat.download"); expected="5d7933a238dcea0446bbbee0e2506692961d16537b9960003e4ece9ecb1ec498"; assert hashlib.sha256(p.read_bytes()).hexdigest()==expected, "Boat download changed; retain the qualified 1.0.85 binary or requalify before cohorts"'
  chmod 700 .mise/boat/boat.download
  mv .mise/boat/boat.download .mise/boat/boat
fi
mise exec -- .mise/boat/boat --no-update --version

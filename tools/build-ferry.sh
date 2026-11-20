#!/usr/bin/env bash
set -euo pipefail

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
assembler=${1:-lmao}
scratch=$(mktemp -d "${TMPDIR:-/tmp}/last-ferry.XXXXXXXX")
trap 'rm -r -- "${scratch:?}"' EXIT

python3 "$project/src/ferry.py" > "$scratch/ferry.hell"
"$assembler" -l 80 -o "$scratch/ferry.mal" "$scratch/ferry.hell"
install -m 644 "$scratch/ferry.mal" "$project/docs/ferry.mal"

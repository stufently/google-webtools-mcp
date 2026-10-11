#!/usr/bin/env bash
# Write SHA256 sums for the immediate *.mcpb files in DIR into SUMS.
#
# Existing lines whose filename does not end in .mcpb stay byte for byte,
# including a final line with no newline (a separator LF is added before the
# bundle lines). GNU-escaped sha256sum lines (leading \) that name a .mcpb
# are replaced, not duplicated. SUMS is replaced only after sha256sum -c
# accepts the new bundle lines, via a temp file in the same directory.
set -euo pipefail

export LC_ALL=C

usage() {
  echo "usage: mcpb-checksums.sh DIR SUMS" >&2
}

is_mcpb_line() {
  local line=$1 body hex name
  if [[ ${line:0:1} == "\\" ]]; then
    body=${line:1}
  else
    body=$line
  fi
  [[ ${#body} -ge 66 ]] || return 1
  [[ ${body:64:2} == '  ' ]] || return 1
  hex=${body:0:64}
  [[ $hex =~ ^[0-9a-f]{64}$ ]] || return 1
  name=${body:66}
  [[ $name == *.mcpb ]]
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

dir=$1
sums=$2
tmp=

cleanup() {
  if [[ -n $tmp ]]; then
    rm -f -- "$tmp"
  fi
}
trap cleanup EXIT

if [[ ! -d $dir ]]; then
  echo "mcpb-checksums: not a directory: ${dir}" >&2
  exit 1
fi

shopt -s nullglob
bundles=()
for path in "$dir"/*.mcpb; do
  if [[ -f $path ]]; then
    bundles+=("$(basename -- "$path")")
  fi
done
shopt -u nullglob

if [[ ${#bundles[@]} -eq 0 ]]; then
  echo "mcpb-checksums: no .mcpb files in ${dir}" >&2
  exit 1
fi

sums_dir=$(dirname -- "$sums")
if [[ ! -d $sums_dir ]]; then
  echo "mcpb-checksums: directory for sums does not exist: ${sums_dir}" >&2
  exit 1
fi

tmp=$(mktemp "${sums_dir}/.mcpb-checksums.XXXXXX")
tmp_abs=$(cd -- "$sums_dir" && pwd -P) || exit 1
tmp_abs="${tmp_abs}/$(basename -- "$tmp")"

if [[ -f $sums ]]; then
  while IFS= read -r line || [[ -n $line ]]; do
    if is_mcpb_line "$line"; then
      continue
    fi
    printf '%s\n' "$line"
  done < "$sums" > "$tmp"
else
  : > "$tmp"
fi

(
  cd -- "$dir" || exit 1
  sha256sum -- "${bundles[@]}" | sort -k2
) >> "$tmp"

if ! (
  cd -- "$dir" || exit 1
  grep -E '^\\?[0-9a-f]{64}  .+\.mcpb$' -- "$tmp_abs" | sha256sum -c --strict -
); then
  echo "mcpb-checksums: sha256sum -c failed; ${sums} left unchanged" >&2
  exit 1
fi

chmod 644 -- "$tmp"
mv -f -- "$tmp" "$sums"
tmp=

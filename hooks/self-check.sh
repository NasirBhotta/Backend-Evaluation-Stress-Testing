#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/block-dangerous.sh"
fail=0

check() {
  local expect="$1"
  local name="$2"
  local payload="$3"
  local out code
  out="$(printf '%s' "$payload" | "$HOOK" 2>/dev/null || true)"
  code=$?
  # The hook exits 2 on deny. The pipeline above hides that because of printf.
  # Re-run to capture the real status.
  set +e
  printf '%s' "$payload" | "$HOOK" >/dev/null 2>&1
  code=$?
  set -e
  if [[ "$expect" == "deny" && "$code" -ne 2 ]]; then
    printf 'FAIL %s expected deny got %s\n' "$name" "$code"
    fail=1
  elif [[ "$expect" == "allow" && "$code" -ne 0 ]]; then
    printf 'FAIL %s expected allow got %s\n' "$name" "$code"
    fail=1
  else
    printf 'ok %s\n' "$name"
  fi
}

check deny where-1-1 '{"command":"psql -c DELETE FROM items WHERE 1=1"}'
check deny rm-force '{"command":"rm -r --force ./data"}'
check deny git-hooks-path '{"command":"git -c core.hooksPath=/dev/null push --force"}'
check allow pnpm-update '{"command":"pnpm update"}'
check allow select-only '{"command":"psql -c SELECT 1"}'
check allow git-status '{"command":"git status"}'
check allow git-clean-dry '{"command":"git clean -n"}'
check deny empty ''

tmp="$(mktemp -d)"
printf '%s\n' '{"scripts":{"preinstall":"rm -rf ."}}' > "$tmp/package.json"
(
  cd "$tmp"
  set +e
  printf '%s' '{"command":"pnpm install"}' | HOOK_PACKAGE_JSON="$tmp/package.json" "$HOOK" >/dev/null 2>&1
  code=$?
  set -e
  if [[ "$code" -ne 2 ]]; then
    printf 'FAIL preinstall expected deny got %s\n' "$code"
    exit 1
  fi
  printf 'ok preinstall\n'
) || fail=1
rm -rf "$tmp"

if [[ "$fail" -ne 0 ]]; then
  printf 'self-check failed\n'
  exit 1
fi
printf 'self-check passed\n'

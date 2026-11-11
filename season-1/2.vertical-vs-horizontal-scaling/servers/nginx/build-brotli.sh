#!/bin/bash
# Builds the ngx_brotli filter module for the installed nginx version into ./modules/.
# Homebrew nginx has no brotli, but it is built with --with-compat, so a dynamic module can be loaded.
# Needs `brew install brotli`. No cmake: ngx_brotli is pointed at brew's static libbrotli instead.
# Re-run after `brew upgrade nginx`, the .so must match the nginx version.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
VER="$(nginx -v 2>&1 | sed 's#.*/##')"
BROTLI="$(brew --prefix brotli)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "https://nginx.org/download/nginx-$VER.tar.gz" | tar xz -C "$WORK"
git clone --depth 1 -q https://github.com/google/ngx_brotli "$WORK/ngx_brotli"

# ngx_brotli expects its own brotli submodule built with cmake. Give it brew's headers and static libs.
B="$WORK/ngx_brotli/deps/brotli"
mkdir -p "$B/c/include" "$B/out"
ln -s "$BROTLI/include/brotli" "$B/c/include/brotli"
ln -s "$BROTLI/lib/libbrotlienc.a" "$BROTLI/lib/libbrotlicommon.a" "$B/out/"

cd "$WORK/nginx-$VER"
./configure --with-compat --add-dynamic-module="$WORK/ngx_brotli" > /dev/null
make modules > /dev/null

mkdir -p "$DIR/modules"
cp objs/ngx_http_brotli_filter_module.so "$DIR/modules/"
echo "built $DIR/modules/ngx_http_brotli_filter_module.so for nginx $VER"

#!/bin/sh
set -eu
# Separate static MozJPEG encoder. Never replace the independent system JPEG
# decoder. SIMD is disabled, so no assembler or extra dependency is downloaded.
proof_mozjpeg_build=${PROOF_MOZJPEG_BUILD_DIR:-/tmp/proof-mozjpeg}
mkdir -p "$proof_mozjpeg_build"
cd "$proof_mozjpeg_build"
if [ ! -f mozjpeg-v4.1.5.tar.gz ]; then
  curl -fsSL https://codeload.github.com/mozilla/mozjpeg/tar.gz/refs/tags/v4.1.5 -o mozjpeg-v4.1.5.tar.gz
fi
echo '9fcbb7171f6ac383f5b391175d6fb3acde5e64c4c4727274eade84ed0998fcc1  mozjpeg-v4.1.5.tar.gz' | sha256sum -c -
tar -xf mozjpeg-v4.1.5.tar.gz
cmake -S mozjpeg-4.1.5 -B build -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DENABLE_SHARED=OFF -DENABLE_STATIC=ON \
  -DWITH_SIMD=OFF -DWITH_TURBOJPEG=OFF -DWITH_JAVA=OFF -DWITH_FUZZ=OFF \
  -DWITH_12BIT=OFF -DWITH_ARITH_ENC=OFF -DWITH_ARITH_DEC=OFF -DPNG_SUPPORTED=OFF
cmake --build build --target jpeg-static --parallel 2
mkdir -p /opt/proof/mozjpeg
cc -O2 -Wall -Wextra -Werror -I build -I mozjpeg-4.1.5 /opt/proof/native_mozjpeg.c \
  build/libjpeg.a -lm -o /opt/proof/mozjpeg/hdr-proof-mozjpeg
cp mozjpeg-4.1.5/LICENSE.md /opt/proof/mozjpeg/LICENSE.md
sha256sum /opt/proof/mozjpeg/hdr-proof-mozjpeg > /opt/proof/mozjpeg/binary-sha256.txt

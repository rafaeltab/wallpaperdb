#!/bin/sh
set -eu

# The runtime LCMS 2.19 binary is already checksum-locked by apk-lock.json.
# Its exact upstream header supplies only declarations, not a second runtime.
mkdir -p /tmp/icc-gainmap-build /opt/proof/icc-gainmap
cd /tmp/icc-gainmap-build
curl -fsSL https://raw.githubusercontent.com/mm2/Little-CMS/lcms2.19/include/lcms2.h -o lcms2.h
echo '67f73413d7168a0cf7fa94ff3eb0d795fb75668b07d02e6ff583110166ca0f38  lcms2.h' | sha256sum -c -
curl -fsSL https://codeload.github.com/AOMediaCodec/libavif/tar.gz/refs/tags/v1.4.1 -o avif.tar.gz
echo 'd4aea31a4becb3273ba7968221be2e48148ba05eb8a68d14e671963e17785648  avif.tar.gz' | sha256sum -c -
tar -xf avif.tar.gz
for patch in full-range small-offset identity moderate-offset; do
    patch -d libavif-1.4.1 -p1 < "/opt/proof/libavif-$patch-gain.patch"
done
echo '5b2129a0377d2b60ef4274c8995ca69f88ee325327df98ed3cd9a370f8c16f44  /opt/proof/libavif-icc-linear-base.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-icc-linear-base.patch
cmake -S libavif-1.4.1 -B avif-build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DAVIF_BUILD_APPS=OFF -DAVIF_BUILD_TESTS=OFF -DAVIF_CODEC_AOM=SYSTEM -DAVIF_CODEC_DAV1D=SYSTEM -DAVIF_LIBYUV=OFF
cmake --build avif-build --target avif --parallel 4
curl -fsSL https://codeload.github.com/google/libultrahdr/tar.gz/e5f5a022fe96fc4dc2ee35c19f733a50df807abe -o uhdr.tar.gz
echo '5a7b6347a4a32c6936b81392cd6394250649380202f86c8214042aa645cc385c  uhdr.tar.gz' | sha256sum -c -
mkdir uhdr
tar -xf uhdr.tar.gz --strip-components=1 -C uhdr
# Use the same already-pinned native metadata/RGB fixes as the precise adapter.
curl -fsSL https://github.com/google/libultrahdr/commit/2ae3c547c37c0dd19f051cfb7b5427d24eb26138.patch -o pr484-code.patch
echo '987c359cf47598f6b65dd9af6d198f9ed308c4cd190fe753a24fa171fbe244c7  pr484-code.patch' | sha256sum -c -
curl -fsSL https://github.com/google/libultrahdr/commit/5b2ce500f5f8103a24a388b76d3c6b615d1028e4.patch -o pr484-tests.patch
echo 'eef6a88d8cb0d161399bd7014bf9210fc77eab34010c72ba2ea35a912d0d992a  pr484-tests.patch' | sha256sum -c -
curl -fsSL https://github.com/google/libultrahdr/commit/2b058012b5bf4a8433c3593c3c9b15daf8cd7848.patch -o pr491.patch
echo 'd21eb75d6aead59b0f148c59475507ce27519cc794773619083d054c1b2403b3  pr491.patch' | sha256sum -c -
patch -d uhdr -p1 < pr484-code.patch
patch -d uhdr -p1 < pr484-tests.patch
patch -d uhdr -p1 < pr491.patch
patch -d uhdr -p1 < /opt/proof/libultrahdr-xmp-arrays.patch
patch -d uhdr -p1 < /opt/proof/libultrahdr-rgb-jpeg.patch
patch -d uhdr -p1 < /opt/proof/libultrahdr-precise-transfer.patch
cmake -S uhdr -B uhdr-build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
    -DUHDR_BUILD_EXAMPLES=OFF -DUHDR_BUILD_TESTS=OFF -DUHDR_BUILD_DEPS=OFF \
    -DUHDR_ENABLE_HEIF=OFF -DUHDR_ENABLE_GLES=OFF -DUHDR_WRITE_XMP=ON -DUHDR_WRITE_ISO=ON
cmake --build uhdr-build --target uhdr-static --parallel 4
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I . -I libavif-1.4.1/include -I uhdr -I uhdr/lib/include \
    /opt/proof/native_icc_gainmap.cpp avif-build/libavif_internal.a uhdr-build/libuhdr.a \
    /usr/lib/liblcms2.so.2 -ljpeg -lpng -laom -ldav1d -pthread -lm -o /opt/proof/icc-gainmap/hdr-proof-icc-gainmap
# Retain the first failed moderate-offset representation. Gamma3.2 exposes
# reader rounding near black; the already declared 1/65536 offset separately
# tests whether its smaller subtraction floor reduces this amplification.
patch -R -d libavif-1.4.1 -p1 < /opt/proof/libavif-moderate-offset-gain.patch
cmake --build avif-build --target avif --parallel 4
mkdir -p /opt/proof/icc-gainmap/smalloffset
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I . -I libavif-1.4.1/include -I uhdr -I uhdr/lib/include \
    /opt/proof/native_icc_gainmap.cpp avif-build/libavif_internal.a uhdr-build/libuhdr.a \
    /usr/lib/liblcms2.so.2 -ljpeg -lpng -laom -ldav1d -pthread -lm -o /opt/proof/icc-gainmap/smalloffset/hdr-proof-icc-gainmap
# Gamma2 is a separate, predeclared map representation. Native libavif
# already applies pow(normalized_log_gain, gamma) and writes matching metadata.
# Keep both gamma1 variants compiled before changing the native defaults.
echo 'f6b46b336722f3f0a967249144555458efec18b3c96f8ed71c359a091cb31948  /opt/proof/libavif-gamma2-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-gamma2-gain.patch
cmake --build avif-build --target avif --parallel 4
mkdir -p /opt/proof/icc-gainmap/smalloffset-gamma2
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I . -I libavif-1.4.1/include -I uhdr -I uhdr/lib/include \
    /opt/proof/native_icc_gainmap.cpp avif-build/libavif_internal.a uhdr-build/libuhdr.a \
    /usr/lib/liblcms2.so.2 -ljpeg -lpng -laom -ldav1d -pthread -lm -o /opt/proof/icc-gainmap/smalloffset-gamma2/hdr-proof-icc-gainmap
# One separate offset at the logarithmic midpoint of the prior native floors.
# Apply after all three retained representations have been built.
echo '6339d3d2e255586b414780314c9dfe20baa3ad6f79eded515f8dbb28c554eb39  /opt/proof/libavif-midpoint-offset-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-midpoint-offset-gain.patch
cmake --build avif-build --target avif --parallel 4
mkdir -p /opt/proof/icc-gainmap/midpointoffset-gamma2
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I . -I libavif-1.4.1/include -I uhdr -I uhdr/lib/include \
    /opt/proof/native_icc_gainmap.cpp avif-build/libavif_internal.a uhdr-build/libuhdr.a \
    /usr/lib/liblcms2.so.2 -ljpeg -lpng -laom -ldav1d -pthread -lm -o /opt/proof/icc-gainmap/midpointoffset-gamma2/hdr-proof-icc-gainmap
sha256sum lcms2.h /usr/lib/liblcms2.so.2 /opt/proof/icc-gainmap/hdr-proof-icc-gainmap \
    /opt/proof/icc-gainmap/smalloffset/hdr-proof-icc-gainmap \
    /opt/proof/icc-gainmap/smalloffset-gamma2/hdr-proof-icc-gainmap \
    /opt/proof/icc-gainmap/midpointoffset-gamma2/hdr-proof-icc-gainmap \
    > /opt/proof/icc-gainmap/binary-sha256.txt
sha256sum lcms2.h avif.tar.gz uhdr.tar.gz pr*.patch /opt/proof/libavif-*-gain.patch \
    /opt/proof/libavif-icc-linear-base.patch /opt/proof/libultrahdr-*.patch \
    > /opt/proof/icc-gainmap/source-sha256.txt
cd /opt/proof
rm -rf /tmp/icc-gainmap-build

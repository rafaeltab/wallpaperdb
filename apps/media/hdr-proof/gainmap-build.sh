#!/bin/sh
set -eu

# libavif's Alpine app package omits the XML gain-map reader. Build the
# independent JPEG gain-map reader against the pinned distribution codecs.
# Build tools and codec headers already come from environment/apk-lock.json.
mkdir -p /tmp/gainmap-build
cd /tmp/gainmap-build
curl -fsSL https://codeload.github.com/AOMediaCodec/libavif/tar.gz/refs/tags/v1.4.1 -o avif.tar.gz
echo 'd4aea31a4becb3273ba7968221be2e48148ba05eb8a68d14e671963e17785648  avif.tar.gz' | sha256sum -c -
tar -xf avif.tar.gz
# Local proof patch: sequence properties must write to the actual output stream.
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-sequence-transform.patch
curl -fsSL https://codeload.github.com/kmurray/libargparse/tar.gz/ee74d1b53bd680748af14e737378de57e2a0a954 -o argparse.tar.gz
echo '7727b0498851e5b6a6fcd734eb667a8a231897e2c86a357aec51cc0664813060  argparse.tar.gz' | sha256sum -c -
mkdir -p libavif-1.4.1/ext/libargparse
tar -xf argparse.tar.gz --strip-components=1 -C libavif-1.4.1/ext/libargparse
cmake -S libavif-1.4.1 -B build -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DAVIF_BUILD_APPS=ON -DAVIF_CODEC_AOM=SYSTEM \
    -DAVIF_CODEC_DAV1D=SYSTEM -DAVIF_LIBXML2=SYSTEM -DAVIF_LIBYUV=OFF
cmake --build build --target avifgainmaputil avifenc avifdec --parallel 4
cp build/avifgainmaputil build/avifenc build/avifdec /usr/local/bin/
# Keep the independent baseline decoder and default encoder above. A separate
# native encoder candidate retains rare gains that the default 0.1% trimming
# policy discards. This can widen the 8-bit map interval; appearance still has
# to pass the unchanged gates after encoding and independent decoding.
echo '4d7c364b56c95dde7225275fe50c12f9e39fbe97f4686080e8a9cc1983878fec  /opt/proof/libavif-full-range-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-full-range-gain.patch
cmake --build build --target avifgainmaputil --parallel 4
mkdir -p /opt/proof/libavif/fullrange
cp build/avifgainmaputil /opt/proof/libavif/fullrange/
sha256sum /opt/proof/libavif/fullrange/avifgainmaputil > /opt/proof/libavif/fullrange/binary-sha256.txt
# Separate precision experiment. The normalized 1/64 default offsets are
# 3.171875 nits at 203-nit white; cancellation amplifies an eight-bit gain-map
# code error near black. A 1/65536 offset reduces that absolute floor but
# widens the gain interval, so unchanged regional gates decide its tradeoff.
echo '3ac99d201fb1ed56b2c73921702fe81c865e3b8fea2e3bc1c2089710dce16d93  /opt/proof/libavif-small-offset-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-small-offset-gain.patch
cmake --build build --target avifgainmaputil --parallel 4
mkdir -p /opt/proof/libavif/smalloffset
cp build/avifgainmaputil /opt/proof/libavif/smalloffset/
sha256sum /opt/proof/libavif/smalloffset/avifgainmaputil > /opt/proof/libavif/smalloffset/binary-sha256.txt
# Keep every prior stage. This encoder additionally stores the gain-map RGB
# codes with the identity matrix, avoiding RGB/YCbCr rounding before AV1.
echo 'acfda7ed7e3e9f4db747801d9cc99f8fc9ba767f45ec9f682618c804fcd5adaf  /opt/proof/libavif-identity-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-identity-gain.patch
cmake --build build --target avifgainmaputil --parallel 4
mkdir -p /opt/proof/libavif/identity
cp build/avifgainmaputil /opt/proof/libavif/identity/
sha256sum /opt/proof/libavif/identity/avifgainmaputil > /opt/proof/libavif/identity/binary-sha256.txt
# An additional candidate trades part of the near-black offset reduction for
# a narrower gain interval. Upscaling can pair a zero authored SDR sample with
# nonzero HDR, widening both extremes. Keep that prior failing representation
# and test this 203/4096-nit offset against the same black and appearance gates.
echo 'dfbbe115d1fcfcae756b61bc5a1f023cd9cd1381c92dd59db345d398b29d86ea  /opt/proof/libavif-moderate-offset-gain.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-moderate-offset-gain.patch
cmake --build build --target avifgainmaputil --parallel 4
mkdir -p /opt/proof/libavif/moderateoffset
cp build/avifgainmaputil /opt/proof/libavif/moderateoffset/
sha256sum /opt/proof/libavif/moderateoffset/avifgainmaputil > /opt/proof/libavif/moderateoffset/binary-sha256.txt
# Separate reader experiment. Keep the baseline reader above unchanged.
# Gain-map JPEG RGB samples need no extra 8-bit BT.601 intermediate.
echo '80a32fe007756fa6f091351908d0ccc9ba6c852e9e2d470595073a946e70f954  /opt/proof/libavif-rgb-reader.patch' | sha256sum -c -
patch -d libavif-1.4.1 -p1 < /opt/proof/libavif-rgb-reader.patch
cmake --build build --target avifgainmaputil --parallel 4
mkdir -p /opt/proof/libavif/rgbreader
cp build/avifgainmaputil /opt/proof/libavif/rgbreader/
sha256sum /opt/proof/libavif/rgbreader/avifgainmaputil > /opt/proof/libavif/rgbreader/binary-sha256.txt
rm -rf /tmp/gainmap-build

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
rm -rf /tmp/gainmap-build

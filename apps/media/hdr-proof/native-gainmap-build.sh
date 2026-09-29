#!/bin/sh
set -eu

# These proposed patches are deliberately separate from Sharp's bundled codec.
# Both upstream PRs were open and unmerged when this experiment was pinned.
# Base tag v2.0.2 resolves to this exact source commit.
mkdir -p /tmp/native-gainmap-build /opt/proof/ultrahdr
cd /tmp/native-gainmap-build
curl -fsSL https://codeload.github.com/google/libultrahdr/tar.gz/e5f5a022fe96fc4dc2ee35c19f733a50df807abe -o source.tar.gz
echo '5a7b6347a4a32c6936b81392cd6394250649380202f86c8214042aa645cc385c  source.tar.gz' | sha256sum -c -
curl -fsSL https://github.com/google/libultrahdr/commit/2ae3c547c37c0dd19f051cfb7b5427d24eb26138.patch -o pr484-code.patch
echo '987c359cf47598f6b65dd9af6d198f9ed308c4cd190fe753a24fa171fbe244c7  pr484-code.patch' | sha256sum -c -
curl -fsSL https://github.com/google/libultrahdr/commit/5b2ce500f5f8103a24a388b76d3c6b615d1028e4.patch -o pr484-tests.patch
echo 'eef6a88d8cb0d161399bd7014bf9210fc77eab34010c72ba2ea35a912d0d992a  pr484-tests.patch' | sha256sum -c -
curl -fsSL https://github.com/google/libultrahdr/commit/2b058012b5bf4a8433c3593c3c9b15daf8cd7848.patch -o pr491.patch
echo 'd21eb75d6aead59b0f148c59475507ce27519cc794773619083d054c1b2403b3  pr491.patch' | sha256sum -c -
echo '1fa1ab115b8d27dd9fd409554db38adc280637f854b1339aa578fe7c25705383  /opt/proof/libultrahdr-xmp-arrays.patch' | sha256sum -c -

for variant in baseline pr484 pr491 both; do
    mkdir -p "$variant/source" "/opt/proof/ultrahdr/$variant"
    tar -xf source.tar.gz --strip-components=1 -C "$variant/source"
    if [ "$variant" = pr484 ] || [ "$variant" = both ]; then
        patch -d "$variant/source" -p1 < pr484-code.patch
        patch -d "$variant/source" -p1 < pr484-tests.patch
    fi
    if [ "$variant" = pr491 ] || [ "$variant" = both ]; then
        patch -d "$variant/source" -p1 < pr491.patch
    fi
    if [ "$variant" = both ]; then
        # Proof-local native parser/writer fix: preserve all three hdrgm RDF
        # channel values. Baseline and individual upstream variants stay intact.
        patch -d "$variant/source" -p1 < /opt/proof/libultrahdr-xmp-arrays.patch
    fi
    cmake -S "$variant/source" -B "$variant/build" -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=ON -DUHDR_BUILD_EXAMPLES=OFF -DUHDR_BUILD_TESTS=OFF \
        -DUHDR_BUILD_DEPS=OFF -DUHDR_ENABLE_HEIF=OFF -DUHDR_ENABLE_GLES=OFF \
        -DUHDR_WRITE_XMP=ON -DUHDR_WRITE_ISO=ON
    cmake --build "$variant/build" --target uhdr --parallel 4
    cp -P "$variant/build"/libuhdr.so* "/opt/proof/ultrahdr/$variant/"
    c++ -std=c++17 -O2 -Wall -Wextra -Werror -I "$variant/source" \
        -DPROOF_VARIANT="\"$variant\"" /opt/proof/native_gainmap.cpp \
        -L "$variant/build" -luhdr -Wl,-rpath,\$ORIGIN \
        -o "/opt/proof/ultrahdr/$variant/hdr-proof-uhdr"
done
cd /opt/proof/ultrahdr
sha256sum */hdr-proof-uhdr */libuhdr.so.2.0.2 > binary-sha256.txt
rm -rf /tmp/native-gainmap-build

#!/bin/sh
set -eu
# JPEGli remains a separate proof binary. These are the libjxl 0.11.2 release
# and its deps.sh Highway revision, with both downloaded archives verified.
proof_jpegli_build=${PROOF_JPEGLI_BUILD_DIR:-/tmp/proof-jpegli}
mkdir -p "$proof_jpegli_build"
cd "$proof_jpegli_build"
if [ ! -f libjxl-v0.11.2.tar.gz ]; then
  curl -fsSL https://codeload.github.com/libjxl/libjxl/tar.gz/refs/tags/v0.11.2 -o libjxl-v0.11.2.tar.gz
fi
echo 'ab38928f7f6248e2a98cc184956021acb927b16a0dee71b4d260dc040a4320ea  libjxl-v0.11.2.tar.gz' | sha256sum -c -
if [ ! -f highway-v1.2.0.tar.gz ]; then
  curl -fsSL https://codeload.github.com/google/highway/tar.gz/457c891775a7397bdb0376bb1031e6e027af1c48 -o highway-v1.2.0.tar.gz
fi
echo '5124b0501c98d9930dbb065bfa1a5bbbd59ce0f12facb7e1e33aaef01a5f1f1a  highway-v1.2.0.tar.gz' | sha256sum -c -
tar -xf libjxl-v0.11.2.tar.gz
mkdir -p highway
tar -xf highway-v1.2.0.tar.gz --strip-components=1 -C highway
mkdir -p project
cp /opt/proof/jpegli.cmake project/CMakeLists.txt
cmake -S project -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
  -DJPEGLI_SOURCE="$proof_jpegli_build/libjxl-0.11.2" \
  -DJPEGLI_HIGHWAY_SOURCE="$proof_jpegli_build/highway" \
  -DJPEGLI_HELPER_SOURCE=/opt/proof/native_jpegli.cpp
cmake --build build --target hdr-proof-jpegli --parallel 2
mkdir -p /opt/proof/jpegli
cp build/hdr-proof-jpegli /opt/proof/jpegli/
cp libjxl-0.11.2/LICENSE /opt/proof/jpegli/LICENSE.libjxl
cp highway/LICENSE /opt/proof/jpegli/LICENSE.highway
sha256sum /opt/proof/jpegli/hdr-proof-jpegli > /opt/proof/jpegli/binary-sha256.txt

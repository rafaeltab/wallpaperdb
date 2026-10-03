#!/bin/sh
set -eu

# Only the public declarations are downloaded. The implementation is the
# existing checksum-recorded precise native library, without another build.
mkdir -p /opt/proof/gainmap-capacity
cd /opt/proof/gainmap-capacity
curl -fsSL https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/ultrahdr_api.h -o ultrahdr_api.h
echo 'dce778b1433375f0713df8b04fb5f8312a22b3d4dc84c29f9289486ac04d33a9  ultrahdr_api.h' | sha256sum -c -
echo '5297ea11d181c7f4f7dc946b1f91f3b812cf41d454b7157c87bef82c693340fd  /opt/proof/ultrahdr/precise/libuhdr.so.2.0.2' | sha256sum -c -
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I . /opt/proof/native_gainmap_capacity.cpp \
    -L /opt/proof/ultrahdr/precise -luhdr -Wl,-rpath,/opt/proof/ultrahdr/precise \
    -o hdr-proof-gainmap-capacity
sha256sum ultrahdr_api.h /opt/proof/native_gainmap_capacity.cpp /opt/proof/gainmap-capacity-build.sh \
    /opt/proof/ultrahdr/precise/libuhdr.so.2.0.2 hdr-proof-gainmap-capacity > provenance-sha256.txt

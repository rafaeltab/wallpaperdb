#!/bin/sh
set -eu
# Match the locked Alpine zimg3.0.6 library with its exact upstream API header.
mkdir -p /tmp/proof-zimg
curl -fsSL https://raw.githubusercontent.com/sekrit-twc/zimg/f819b14e8f39d1282400b0d9543e8ef73c1b2bbd/src/zimg/api/zimg.h -o /tmp/proof-zimg/zimg.h
echo 'a6ce51e4c3040e53b3ec7ad8511dec847ccccc0028e2ae3ab5273b735d2f3fde  /tmp/proof-zimg/zimg.h' | sha256sum -c -
cc -O2 -Wall -Wextra -Werror -I /tmp/proof-zimg /opt/proof/native_zimg_window.c \
   -Wl,-l:libzimg.so.2 -lm -o /usr/local/bin/hdr-proof-zimg-window
rm -rf /tmp/proof-zimg

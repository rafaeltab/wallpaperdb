FROM node:22.22.3-alpine@sha256:e58326d0d441090181ac150dc2078d3e2cf6a0d42e809aebba3ef5880935ffdd
COPY environment /opt/proof/environment
RUN node /opt/proof/environment/install-apk.cjs \
      /opt/proof/environment/apk-lock.json /tmp/hdr-proof-apk \
    && rm -rf /tmp/hdr-proof-apk
RUN cp /opt/proof/environment/package.json /opt/proof/environment/package-lock.json /opt/proof/ \
    && cd /opt/proof && npm ci --no-audit --no-fund
ENV NODE_PATH=/opt/proof/node_modules
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
COPY gainmap-build.sh libavif-sequence-transform.patch libavif-full-range-gain.patch libavif-small-offset-gain.patch libavif-identity-gain.patch libavif-moderate-offset-gain.patch libavif-rgb-reader.patch /opt/proof/
RUN sh /opt/proof/gainmap-build.sh
COPY native-gainmap-build.sh native_gainmap.cpp libultrahdr-xmp-arrays.patch libultrahdr-rgb-jpeg.patch libultrahdr-precise-transfer.patch /opt/proof/
RUN sh /opt/proof/native-gainmap-build.sh
COPY png_decode.c /opt/proof/png_decode.c
RUN cc -O2 -Wall -Wextra -Werror /opt/proof/png_decode.c -lpng -o /usr/local/bin/hdr-proof-png-decode
COPY native-zimg-build.sh native_zimg_window.c /opt/proof/
RUN sh /opt/proof/native-zimg-build.sh
COPY native_lossless_jpeg.c /opt/proof/native_lossless_jpeg.c
RUN cc -O2 -Wall -Wextra -Werror /opt/proof/native_lossless_jpeg.c -ljpeg -o /usr/local/bin/hdr-proof-lossless-jpeg
COPY native_dct_jpeg.c /opt/proof/native_dct_jpeg.c
RUN cc -O2 -Wall -Wextra -Werror /opt/proof/native_dct_jpeg.c -ljpeg -o /usr/local/bin/hdr-proof-dct-jpeg
WORKDIR /proof

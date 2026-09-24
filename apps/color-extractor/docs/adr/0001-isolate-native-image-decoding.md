# Isolate native image decoding

Sharp metadata reads do not honor its pixel-pipeline timeout, and interrupting an Effect cannot stop native libvips work. Color Extractor runs decoding in an owned child process, kills it on interruption or a ten-second deadline, and waits for process exit before releasing its permit or other application resources. This costs process startup per image, but gives shutdown a real termination mechanism without detaching native work or claiming that a Promise timeout cancels it.

The parent retains the pure HSV calculation. The child preserves the previous metadata and resize arithmetic, including extreme aspect ratios. The build emits the decoder beside the service executable; both artifacts must ship together. Linux process tests stop a real decoder with SIGSTOP and verify that deadline and interruption reap it before returning.

/* Proof-only native RGB8 baseline JPEG with the library floating DCT.
 * Header/pixel I/O only; libjpeg owns quantization and transform arithmetic. */
#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>

#define STRINGIFY_INNER(value) #value
#define STRINGIFY(value) STRINGIFY_INNER(value)

static unsigned integer(const char *text) {
  char *end;
  long value = strtol(text, &end, 10);
  if (!*text || *end || value < 1 || value > 4096) {
    fprintf(stderr, "Dimensions and components must be positive bounded integers\n");
    exit(2);
  }
  return (unsigned)value;
}

int main(int argc, char **argv) {
  if (argc != 7) {
    fprintf(stderr, "input.raw output.jpg width height components profile.icc-or-dash\n");
    return 2;
  }
  unsigned width = integer(argv[3]), height = integer(argv[4]);
  unsigned components = integer(argv[5]);
  if (components != 1 && components != 3) return 2;
  size_t size = (size_t)width * height * components;
  unsigned char *pixels = malloc(size), *profile = NULL;
  unsigned long profile_size = 0;
  FILE *input = fopen(argv[1], "rb");
  if (!pixels || !input || fread(pixels, 1, size, input) != size || fgetc(input) != EOF) {
    fprintf(stderr, "Raw input does not match declared dimensions/components\n");
    return 2;
  }
  fclose(input);
  if (argv[6][0] != '-' || argv[6][1]) {
    FILE *icc = fopen(argv[6], "rb");
    if (!icc || fseek(icc, 0, SEEK_END)) return 2;
    long length = ftell(icc);
    if (length < 1 || length > 8 * 1024 * 1024) return 2;
    profile_size = (unsigned long)length;
    rewind(icc);
    profile = malloc(profile_size);
    if (!profile || fread(profile, 1, profile_size, icc) != profile_size) return 2;
    fclose(icc);
  }
  FILE *output = fopen(argv[2], "wb");
  if (!output) return 2;
  struct jpeg_compress_struct encoder;
  struct jpeg_error_mgr error;
  encoder.err = jpeg_std_error(&error);
  jpeg_create_compress(&encoder);
  jpeg_stdio_dest(&encoder, output);
  encoder.image_width = width;
  encoder.image_height = height;
  encoder.input_components = components;
  encoder.in_color_space = components == 3 ? JCS_RGB : JCS_GRAYSCALE;
  jpeg_set_defaults(&encoder);
  jpeg_set_colorspace(&encoder, encoder.in_color_space);
  jpeg_set_quality(&encoder, 100, TRUE);
  encoder.dct_method = JDCT_FLOAT;
  jpeg_start_compress(&encoder, TRUE);
  if (profile_size) jpeg_write_icc_profile(&encoder, profile, profile_size);
  while (encoder.next_scanline < encoder.image_height) {
    JSAMPROW row = pixels + (size_t)encoder.next_scanline * width * components;
    jpeg_write_scanlines(&encoder, &row, 1);
  }
  jpeg_finish_compress(&encoder);
  jpeg_destroy_compress(&encoder);
  if (fclose(output)) return 2;
  free(pixels);
  free(profile);
  printf("{\"method\":\"float\",\"depth\":8,\"sof\":0,\"native_encoder\":\"libjpeg-turbo %s\"}\n",
         STRINGIFY(LIBJPEG_TURBO_VERSION));
  return 0;
}

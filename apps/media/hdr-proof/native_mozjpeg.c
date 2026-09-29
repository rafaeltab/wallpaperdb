/* Proof-only raw I/O around unmodified MozJPEG's native coefficient choices. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <jpeglib.h>

static unsigned dimension(const char *text) {
  char *end;
  long value = strtol(text, &end, 10);
  if (!*text || *end || value < 1 || value > 4096) {
    fprintf(stderr, "Dimensions must be bounded positive integers\n");
    exit(2);
  }
  return (unsigned)value;
}

static boolean flag(const char *text) {
  if (strcmp(text, "0") == 0) return FALSE;
  if (strcmp(text, "1") == 0) return TRUE;
  exit(2);
}

int main(int argc, char **argv) {
  if (argc != 9 && argc != 10) {
    fprintf(stderr, "input.raw output.jpg width height profile.icc-or-dash islow|float trellis0|1 deringing0|1 [optimized-huffman0|1]\n");
    return 2;
  }
  unsigned width = dimension(argv[3]), height = dimension(argv[4]);
  boolean floating = strcmp(argv[6], "float") == 0;
  if (!floating && strcmp(argv[6], "islow")) return 2;
  boolean trellis = flag(argv[7]), deringing = flag(argv[8]);
  boolean optimized_huffman = argc == 10 ? flag(argv[9]) : TRUE;
  size_t size = (size_t)width * height * 3;
  unsigned char *pixels = malloc(size), *profile = NULL;
  unsigned long profile_size = 0;
  FILE *input = fopen(argv[1], "rb");
  if (!pixels || !input || fread(pixels, 1, size, input) != size || fgetc(input) != EOF) {
    fprintf(stderr, "Raw RGB8 input does not match the declared dimensions\n");
    return 2;
  }
  fclose(input);
  if (strcmp(argv[5], "-")) {
    FILE *icc = fopen(argv[5], "rb");
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
  encoder.input_components = 3;
  encoder.in_color_space = JCS_RGB;
  jpeg_c_set_int_param(&encoder, JINT_COMPRESS_PROFILE, JCP_FASTEST);
  jpeg_set_defaults(&encoder);
  jpeg_set_colorspace(&encoder, JCS_RGB);
  jpeg_c_set_int_param(&encoder, JINT_BASE_QUANT_TBL_IDX, 0);
  jpeg_set_quality(&encoder, 100, TRUE);
  encoder.dct_method = floating ? JDCT_FLOAT : JDCT_ISLOW;
  encoder.scan_info = NULL;
  encoder.num_scans = 0;
  encoder.arith_code = FALSE;
  /* Native trellis needs Huffman tables computed for its selected coefficients.
   * Keep the failed standard-table setup reproducible as an explicit option. */
  encoder.optimize_coding = optimized_huffman;
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_OPTIMIZE_SCANS, FALSE);
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_TRELLIS_QUANT, trellis);
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_TRELLIS_QUANT_DC, trellis);
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_OVERSHOOT_DERINGING, deringing);
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_TRELLIS_Q_OPT, FALSE);
  jpeg_c_set_bool_param(&encoder, JBOOLEAN_USE_SCANS_IN_TRELLIS, FALSE);
  jpeg_start_compress(&encoder, TRUE);
  if (profile_size) jpeg_write_icc_profile(&encoder, profile, profile_size);
  while (encoder.next_scanline < height) {
    JSAMPROW row = pixels + (size_t)encoder.next_scanline * width * 3;
    jpeg_write_scanlines(&encoder, &row, 1);
  }
  jpeg_finish_compress(&encoder);
  jpeg_destroy_compress(&encoder);
  if (fclose(output)) return 2;
  free(pixels);
  free(profile);
  printf("{\"native_encoder\":\"MozJPEG 4.1.5\",\"method\":\"%s\","
         "\"trellis\":%s,\"deringing\":%s,\"optimized_huffman\":%s,"
         "\"quality\":100,\"coded_depth\":8,\"simd\":false}\n",
         argv[6], trellis ? "true" : "false", deringing ? "true" : "false",
         optimized_huffman ? "true" : "false");
  return 0;
}

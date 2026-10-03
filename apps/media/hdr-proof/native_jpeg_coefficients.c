/* Read-only coefficient evidence from the independently pinned system libjpeg. */
#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>

static unsigned coordinate(const char *text) {
  char *end;
  long value = strtol(text, &end, 10);
  if (!*text || *end || value < 0 || value > 4095) {
    fprintf(stderr, "Invalid bounded JPEG coordinates\n");
    exit(2);
  }
  return (unsigned)value;
}

int main(int argc, char **argv) {
  if (argc != 6) {
    fprintf(stderr, "input.jpg x y reference-block-x reference-block-y\n");
    return 2;
  }
  unsigned x[2] = {coordinate(argv[2]), coordinate(argv[4])};
  unsigned y[2] = {coordinate(argv[3]), coordinate(argv[5])};
  FILE *input = fopen(argv[1], "rb");
  if (!input) return 2;
  struct jpeg_decompress_struct decoder;
  struct jpeg_error_mgr error;
  decoder.err = jpeg_std_error(&error);
  jpeg_create_decompress(&decoder);
  jpeg_stdio_src(&decoder, input);
  jpeg_read_header(&decoder, TRUE);
  if (decoder.data_precision != 8 || decoder.num_components != 3 || decoder.progressive_mode ||
      decoder.arith_code || decoder.image_width > 4096 || decoder.image_height > 4096) {
    fprintf(stderr, "Coefficient proof requires bounded baseline RGB8 JPEG\n");
    return 2;
  }
  for (int c = 0; c < 3; c++) {
    if (decoder.comp_info[c].component_id != "RGB"[c] ||
        decoder.comp_info[c].h_samp_factor != 1 || decoder.comp_info[c].v_samp_factor != 1) {
      fprintf(stderr, "Coefficient proof requires RGB8 JPEG without subsampling\n");
      return 2;
    }
  }
  for (int i = 0; i < 2; i++) {
    if (x[i] >= decoder.image_width || y[i] >= decoder.image_height) {
      fprintf(stderr, "JPEG coordinates are outside the image\n");
      return 2;
    }
  }
  jvirt_barray_ptr *blocks = jpeg_read_coefficients(&decoder);
  printf("{\"width\":%u,\"height\":%u,\"libjpeg_api\":%d,\"components\":[",
         decoder.image_width, decoder.image_height, JPEG_LIB_VERSION);
  for (int c = 0; c < 3; c++) {
    jpeg_component_info *component = &decoder.comp_info[c];
    JQUANT_TBL *quantization = decoder.quant_tbl_ptrs[component->quant_tbl_no];
    if (!quantization) return 2;
    printf("%s{\"id\":%d,\"quantization\":[", c ? "," : "", component->component_id);
    for (int i = 0; i < 64; i++) printf("%s%u", i ? "," : "", quantization->quantval[i]);
    printf("],\"blocks\":[");
    for (int i = 0; i < 2; i++) {
      JBLOCKARRAY row = decoder.mem->access_virt_barray((j_common_ptr)&decoder, blocks[c], y[i]/8, 1, FALSE);
      printf("%s[", i ? "," : "");
      for (int k = 0; k < 64; k++) printf("%s%d", k ? "," : "", row[0][x[i]/8][k]);
      printf("]");
    }
    printf("],\"dc\":[");
    for (unsigned by = 0; by < component->height_in_blocks; by++) {
      JBLOCKARRAY row = decoder.mem->access_virt_barray((j_common_ptr)&decoder, blocks[c], by, 1, FALSE);
      printf("%s[", by ? "," : "");
      for (unsigned bx = 0; bx < component->width_in_blocks; bx++) printf("%s%d", bx ? "," : "", row[0][bx][0]);
      printf("]");
    }
    printf("]}");
  }
  printf("]}\n");
  jpeg_finish_decompress(&decoder);
  long warnings = decoder.err->num_warnings;
  jpeg_destroy_decompress(&decoder);
  fclose(input);
  if (warnings) {
    fprintf(stderr, "Native coefficient reader reported JPEG warnings\n");
    return 2;
  }
  return 0;
}

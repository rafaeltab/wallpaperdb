// Proof-only I/O around unmodified JPEGli. Float input still emits JPEG RGB8.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "lib/jpegli/common.h"
#include "lib/jpegli/encode.h"

static unsigned dimension(const char* text) {
  char* end;
  long value = std::strtol(text, &end, 10);
  if (!*text || *end || value < 1 || value > 4096) {
    std::fprintf(stderr, "Dimensions must be bounded positive integers\n");
    std::exit(2);
  }
  return static_cast<unsigned>(value);
}

static std::vector<unsigned char> read(const char* path, size_t maximum) {
  FILE* file = std::fopen(path, "rb");
  if (!file || std::fseek(file, 0, SEEK_END)) std::exit(2);
  long length = std::ftell(file);
  if (length < 1 || static_cast<size_t>(length) > maximum) std::exit(2);
  std::rewind(file);
  std::vector<unsigned char> bytes(static_cast<size_t>(length));
  if (std::fread(bytes.data(), 1, bytes.size(), file) != bytes.size()) std::exit(2);
  std::fclose(file);
  return bytes;
}

int main(int argc, char** argv) {
  if (argc != 9 && argc != 10) {
    std::fprintf(stderr, "input.raw output.jpg width height profile.icc-or-dash uint8|float32 standard|jpegli adaptive0|1 [quality98|99|100]\n");
    return 2;
  }
  const unsigned width = dimension(argv[3]), height = dimension(argv[4]);
  const bool floating = std::strcmp(argv[6], "float32") == 0;
  const bool standard = std::strcmp(argv[7], "standard") == 0;
  if ((!floating && std::strcmp(argv[6], "uint8")) ||
      (!standard && std::strcmp(argv[7], "jpegli")) ||
      (std::strcmp(argv[8], "0") && std::strcmp(argv[8], "1"))) return 2;
  const bool adaptive = std::strcmp(argv[8], "1") == 0;
  const unsigned quality = argc == 10 ? dimension(argv[9]) : 100;
  if (quality < 98 || quality > 100) return 2;
  const size_t stride = width * 3 * (floating ? sizeof(float) : 1);
  auto pixels = read(argv[1], stride * height);
  if (pixels.size() != stride * height) return 2;
  if (floating) {
    for (size_t index = 0; index < pixels.size(); index += sizeof(float)) {
      float value;
      std::memcpy(&value, pixels.data() + index, sizeof(value));
      if (!std::isfinite(value) || value < 0 || value > 1) return 2;
    }
  }
  std::vector<unsigned char> profile;
  if (std::strcmp(argv[5], "-")) profile = read(argv[5], 8 * 1024 * 1024);
  FILE* output = std::fopen(argv[2], "wb");
  if (!output) return 2;
  jpeg_compress_struct encoder;
  jpeg_error_mgr error;
  encoder.err = jpegli_std_error(&error);
  jpegli_create_compress(&encoder);
  jpegli_stdio_dest(&encoder, output);
  encoder.image_width = width;
  encoder.image_height = height;
  encoder.input_components = 3;
  encoder.in_color_space = JCS_RGB;
  if (standard) jpegli_use_standard_quant_tables(&encoder);
  jpegli_set_defaults(&encoder);
  jpegli_set_colorspace(&encoder, JCS_RGB);
  jpegli_set_quality(&encoder, static_cast<int>(quality), TRUE);
  jpegli_enable_adaptive_quantization(&encoder, adaptive);
  jpegli_set_progressive_level(&encoder, 0);
  jpegli_set_input_format(&encoder, floating ? JPEGLI_TYPE_FLOAT : JPEGLI_TYPE_UINT8,
                          JPEGLI_LITTLE_ENDIAN);
  encoder.data_precision = 8;
  for (int channel = 0; channel < 3; ++channel) {
    encoder.comp_info[channel].h_samp_factor = 1;
    encoder.comp_info[channel].v_samp_factor = 1;
  }
  jpegli_start_compress(&encoder, TRUE);
  if (!profile.empty()) jpegli_write_icc_profile(&encoder, profile.data(), profile.size());
  while (encoder.next_scanline < height) {
    JSAMPROW row = pixels.data() + encoder.next_scanline * stride;
    jpegli_write_scanlines(&encoder, &row, 1);
  }
  jpegli_finish_compress(&encoder);
  jpegli_destroy_compress(&encoder);
  if (std::fclose(output)) return 2;
  std::printf("{\"native_encoder\":\"JPEGli from libjxl 0.11.2\",\"input_type\":\"%s\","
              "\"tables\":\"%s\",\"adaptive\":%s,\"quality\":%u,\"coded_depth\":8}\n",
              argv[6], argv[7], adaptive ? "true" : "false", quality);
  return 0;
}

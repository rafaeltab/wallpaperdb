// Proof-only adapter for libultrahdr's compressed base/map APIs. Geometry is
// performed separately by native Sharp; this program never regenerates a map.
#include "ultrahdr_api.h"

#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#ifndef PROOF_VARIANT
#define PROOF_VARIANT "unspecified"
#endif

using Bytes = std::vector<unsigned char>;
using Decoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_decoder)>;
using Encoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_encoder)>;

static void check(uhdr_error_info_t status, const char* operation) {
  if (status.error_code != UHDR_CODEC_OK) {
    throw std::runtime_error(std::string(operation) + ": " + status.detail +
                             " (native error " + std::to_string(status.error_code) + ")");
  }
}

static Bytes read(const char* path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) throw std::runtime_error(std::string("Cannot read ") + path);
  return Bytes(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

static void write(const char* path, const void* data, size_t size) {
  std::ofstream stream(path, std::ios::binary);
  stream.write(static_cast<const char*>(data), size);
  if (!stream) throw std::runtime_error(std::string("Cannot write ") + path);
}

static uhdr_compressed_image_t image(void* data, size_t size) {
  return {data, size, size, UHDR_CG_UNSPECIFIED, UHDR_CT_UNSPECIFIED, UHDR_CR_UNSPECIFIED};
}

static void array(const float values[3]) {
  std::cout << '[' << values[0] << ',' << values[1] << ',' << values[2] << ']';
}

static void describe(uhdr_codec_private_t* decoder) {
  const auto* metadata = uhdr_dec_get_gainmap_metadata(decoder);
  if (!metadata) throw std::runtime_error("Native decoder returned no gain-map metadata");
  std::cout << std::setprecision(9) << "{\"variant\":\"" << PROOF_VARIANT
            << "\",\"version\":\"" << UHDR_LIB_VERSION_STR
            << "\",\"width\":" << uhdr_dec_get_image_width(decoder)
            << ",\"height\":" << uhdr_dec_get_image_height(decoder)
            << ",\"map_width\":" << uhdr_dec_get_gainmap_width(decoder)
            << ",\"map_height\":" << uhdr_dec_get_gainmap_height(decoder)
            << ",\"use_base_cg\":" << (metadata->use_base_cg ? "true" : "false")
            << ",\"hdr_capacity_min\":" << metadata->hdr_capacity_min
            << ",\"hdr_capacity_max\":" << metadata->hdr_capacity_max
            << ",\"maximum_boost\":";
  array(metadata->max_content_boost);
  std::cout << ",\"minimum_boost\":";
  array(metadata->min_content_boost);
  std::cout << ",\"gamma\":";
  array(metadata->gamma);
  std::cout << ",\"sdr_offset\":";
  array(metadata->offset_sdr);
  std::cout << ",\"hdr_offset\":";
  array(metadata->offset_hdr);
  std::cout << "}\n";
}

int main(int argc, char** argv) {
  try {
    if (argc < 3) throw std::runtime_error("Usage: hdr-proof-uhdr probe input | extract input base map | roundtrip input output | pack metadata-source base map output");
    const std::string mode(argv[1]);
    const bool probe = mode == "probe" && argc == 3;
    const bool extract = mode == "extract" && argc == 5;
    const bool roundtrip = mode == "roundtrip" && argc == 4;
    const bool pack = mode == "pack" && argc == 6;
    if (!(probe || extract || roundtrip || pack)) throw std::runtime_error("Invalid operation or argument count");
    Bytes input = read(argv[2]);
    auto compressed = image(input.data(), input.size());
    Decoder decoder(uhdr_create_decoder(), uhdr_release_decoder);
    if (!decoder) throw std::runtime_error("Cannot allocate native decoder");
    check(uhdr_dec_set_image(decoder.get(), &compressed), "set source");
    check(uhdr_dec_probe(decoder.get()), "probe source");
    if (probe) {
      describe(decoder.get());
      return 0;
    }
    const auto* source_base = uhdr_dec_get_base_image(decoder.get());
    const auto* source_map = uhdr_dec_get_gainmap_image(decoder.get());
    const auto* source_metadata = uhdr_dec_get_gainmap_metadata(decoder.get());
    if (!source_base || !source_map || !source_metadata) throw std::runtime_error("Native decoder did not expose both compressed parts and metadata");
    if (extract) {
      write(argv[3], source_base->data, source_base->data_sz);
      write(argv[4], source_map->data, source_map->data_sz);
      describe(decoder.get());
      return 0;
    }
    Bytes transformed_base, transformed_map;
    auto base = image(source_base->data, source_base->data_sz);
    auto gain = image(source_map->data, source_map->data_sz);
    if (pack) {
      transformed_base = read(argv[3]);
      transformed_map = read(argv[4]);
      base = image(transformed_base.data(), transformed_base.size());
      gain = image(transformed_map.data(), transformed_map.size());
    }
    Encoder encoder(uhdr_create_encoder(), uhdr_release_encoder);
    if (!encoder) throw std::runtime_error("Cannot allocate native encoder");
    auto metadata = *source_metadata;
    check(uhdr_enc_set_compressed_image(encoder.get(), &base, UHDR_BASE_IMG), "set compressed base");
    check(uhdr_enc_set_gainmap_image(encoder.get(), &gain, &metadata), "set compressed map");
    check(uhdr_encode(encoder.get()), "encode retained parts");
    const auto* output = uhdr_get_encoded_stream(encoder.get());
    if (!output) throw std::runtime_error("Native encoder returned no output");
    write(argv[pack ? 5 : 3], output->data, output->data_sz);
    describe(decoder.get());
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

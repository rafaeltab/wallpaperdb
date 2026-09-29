// Isolated source-capacity packing experiment. The pinned native encoder
// receives the original compressed parts and all original channel metadata.
#include "ultrahdr_api.h"
#include <cmath>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using Bytes = std::vector<unsigned char>;
using Decoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_decoder)>;
using Encoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_encoder)>;

static void check(uhdr_error_info_t status) {
  if (status.error_code != UHDR_CODEC_OK) throw std::runtime_error(status.detail);
}
static Bytes read(const char* path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) throw std::runtime_error("Cannot read input");
  return Bytes(std::istreambuf_iterator<char>(file), {});
}
static uhdr_compressed_image_t image(Bytes& bytes) {
  return {bytes.data(), bytes.size(), bytes.size(), UHDR_CG_UNSPECIFIED, UHDR_CT_UNSPECIFIED, UHDR_CR_UNSPECIFIED};
}
static Decoder probe(Bytes& bytes) {
  Decoder decoder(uhdr_create_decoder(), uhdr_release_decoder);
  if (!decoder) throw std::runtime_error("Cannot allocate decoder");
  auto input = image(bytes);
  check(uhdr_dec_set_image(decoder.get(), &input));
  check(uhdr_dec_probe(decoder.get()));
  return decoder;
}
static void reject_source_xmp(const uhdr_mem_block_t* part) {
  if (!part || !part->data || part->data_sz < 4) throw std::runtime_error("Missing source JPEG part");
  const auto* bytes = static_cast<const unsigned char*>(part->data);
  if (bytes[0] != 255 || bytes[1] != 216) throw std::runtime_error("Expected source JPEG");
  size_t pos = 2;
  while (pos + 4 <= part->data_sz) {
    if (bytes[pos++] != 255) throw std::runtime_error("Malformed source JPEG marker");
    while (pos < part->data_sz && bytes[pos] == 255) ++pos;
    if (pos >= part->data_sz) break;
    const unsigned marker = bytes[pos++];
    if (marker == 218 || marker == 217) return;
    if (pos + 2 > part->data_sz) break;
    const size_t size = size_t(bytes[pos]) * 256 + bytes[pos + 1];
    if (size < 2 || pos + size > part->data_sz) break;
    constexpr char xmp[] = "http://ns.adobe.com/xap/1.0/";
    constexpr char extended[] = "http://ns.adobe.com/xmp/extension/";
    const auto* payload = bytes + pos + 2;
    if (marker == 225 && ((size >= 2 + sizeof(xmp) && !std::memcmp(payload, xmp, sizeof(xmp))) ||
                         (size >= 2 + sizeof(extended) && !std::memcmp(payload, extended, sizeof(extended)))))
      throw std::runtime_error("Source-capacity proof admits ISO-only source metadata; XMP is rejected");
    pos += size;
  }
  throw std::runtime_error("Truncated source JPEG header");
}
static void require_forward(const uhdr_gainmap_metadata_t* metadata) {
  if (!metadata || !metadata->use_base_cg || metadata->hdr_capacity_min != 1 ||
      !std::isfinite(metadata->hdr_capacity_max) || metadata->hdr_capacity_max <= 1 ||
      metadata->hdr_capacity_max > 64)
    throw std::runtime_error("Expected established forward SDR-base capacity in (1,64]");
}
int main(int argc, char** argv) {
  try {
    if (argc != 7 || std::string(argv[1]) != "pack-source-capacity")
      throw std::runtime_error("pack-source-capacity source candidate base map output");
    auto source = read(argv[2]), candidate = read(argv[3]);
    auto source_decoder = probe(source), candidate_decoder = probe(candidate);
    reject_source_xmp(uhdr_dec_get_base_image(source_decoder.get()));
    reject_source_xmp(uhdr_dec_get_gainmap_image(source_decoder.get()));
    const auto* source_metadata = uhdr_dec_get_gainmap_metadata(source_decoder.get());
    const auto* candidate_metadata = uhdr_dec_get_gainmap_metadata(candidate_decoder.get());
    require_forward(source_metadata);
    require_forward(candidate_metadata);
    auto metadata = *candidate_metadata;
    for (unsigned channel = 0; channel < 3; ++channel)
      if (metadata.gamma[channel] != 1.5f || metadata.offset_sdr[channel] != 1.f/16384 ||
          metadata.offset_hdr[channel] != 1.f/16384)
        throw std::runtime_error("Expected unchanged midpointoffset gamma1.5 candidate metadata");
    metadata.hdr_capacity_min = source_metadata->hdr_capacity_min;
    metadata.hdr_capacity_max = source_metadata->hdr_capacity_max;
    auto base = read(argv[4]), map = read(argv[5]);
    auto base_image = image(base), map_image = image(map);
    Encoder encoder(uhdr_create_encoder(), uhdr_release_encoder);
    if (!encoder) throw std::runtime_error("Cannot allocate encoder");
    check(uhdr_enc_set_compressed_image(encoder.get(), &base_image, UHDR_BASE_IMG));
    check(uhdr_enc_set_gainmap_image(encoder.get(), &map_image, &metadata));
    check(uhdr_encode(encoder.get()));
    const auto* output = uhdr_get_encoded_stream(encoder.get());
    if (!output || !output->data || !output->data_sz) throw std::runtime_error("No encoded output");
    std::ofstream file(argv[6], std::ios::binary);
    file.write(static_cast<const char*>(output->data), output->data_sz);
    if (!file) throw std::runtime_error("Cannot write output");
    std::cout << std::setprecision(9) << "{\"source_capacity_min\":" << metadata.hdr_capacity_min
      << ",\"source_capacity_max\":" << metadata.hdr_capacity_max
      << ",\"prior_capacity_min\":" << candidate_metadata->hdr_capacity_min
      << ",\"prior_capacity_max\":" << candidate_metadata->hdr_capacity_max
      << ",\"libultrahdr_version\":\"" << UHDR_LIB_VERSION_STR << "\"}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

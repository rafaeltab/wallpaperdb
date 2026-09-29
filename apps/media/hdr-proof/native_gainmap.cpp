// Proof-only adapter for native retained-map packing and HDR/SDR intent
// regeneration. Sharp/FFmpeg perform geometry; libultrahdr computes the map.
#include "ultrahdr_api.h"
#include <avif/avif.h>
#include "ultrahdr/gainmapmath.h"

#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <csetjmp>
#include <cstdio>
#include <jpeglib.h>
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

struct JpegError {
  jpeg_error_mgr manager;
  std::jmp_buf jump;
  char detail[JMSG_LENGTH_MAX];
};

static void jpeg_error(j_common_ptr decoder) {
  auto* error = reinterpret_cast<JpegError*>(decoder->err);
  decoder->err->format_message(decoder, error->detail);
  std::longjmp(error->jump, 1);
}

static void check_jpeg(const Bytes& bytes, const avifImage* expected, const char* label) {
  jpeg_decompress_struct decoder{};
  JpegError error{};
  decoder.err = jpeg_std_error(&error.manager);
  error.manager.error_exit = jpeg_error;
  if (setjmp(error.jump)) {
    jpeg_destroy_decompress(&decoder);
    throw std::runtime_error(std::string(label) + " JPEG header: " + error.detail);
  }
  jpeg_create_decompress(&decoder);
  jpeg_mem_src(&decoder, bytes.data(), bytes.size());
  jpeg_read_header(&decoder, TRUE);
  const bool dimensions = decoder.image_width == expected->width && decoder.image_height == expected->height;
  const bool layout = decoder.data_precision == 8 && decoder.num_components == 3 &&
                     (decoder.jpeg_color_space == JCS_YCbCr || decoder.jpeg_color_space == JCS_RGB);
  jpeg_destroy_decompress(&decoder);
  if (!dimensions) throw std::runtime_error(std::string(label) + " JPEG dimensions differ from native AVIF intent");
  if (!layout) throw std::runtime_error(std::string(label) + " JPEG requires 8-bit RGB or YCbCr layout");
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
    if (argc > 1 && std::string(argv[1]) == "pack-avif") {
      if (argc != 6) throw std::runtime_error("pack-avif avif base map output");
      auto avif = std::unique_ptr<avifImage, decltype(&avifImageDestroy)>(avifImageCreateEmpty(), avifImageDestroy);
      auto decoder = std::unique_ptr<avifDecoder, decltype(&avifDecoderDestroy)>(avifDecoderCreate(), avifDecoderDestroy);
      if (!avif || !decoder) throw std::runtime_error("Cannot allocate native AVIF decoder");
      decoder->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL;
      avifResult result = avifDecoderReadFile(decoder.get(), avif.get(), argv[2]);
      if (result != AVIF_RESULT_OK) throw std::runtime_error(avifResultToString(result));
      const avifGainMap* map = avif->gainMap;
      if (!map || !map->image) throw std::runtime_error("No native AVIF gain map");
      if (avif->depth != 8 || map->image->depth != 8 || !map->useBaseColorSpace ||
          avif->yuvFormat != AVIF_PIXEL_FORMAT_YUV444 || map->image->yuvFormat != AVIF_PIXEL_FORMAT_YUV444 ||
          avif->alphaPlane || map->image->alphaPlane || avif->transformFlags || map->image->transformFlags)
        throw std::runtime_error("JPEG packing requires opaque 8-bit 444 base/map, identity orientation, and base-color-space application");
      auto fraction = [](auto v) -> float {
        if (v.d == 0) throw std::runtime_error("Zero native metadata denominator");
        return static_cast<float>(v.n) / v.d;
      };
      uhdr_gainmap_metadata_t metadata{};
      for (unsigned c = 0; c < 3; ++c) {
        metadata.min_content_boost[c] = exp2(fraction(map->gainMapMin[c]));
        metadata.max_content_boost[c] = exp2(fraction(map->gainMapMax[c]));
        metadata.gamma[c] = fraction(map->gainMapGamma[c]);
        metadata.offset_sdr[c] = fraction(map->baseOffset[c]);
        metadata.offset_hdr[c] = fraction(map->alternateOffset[c]);
        if (!std::isfinite(metadata.min_content_boost[c]) || !std::isfinite(metadata.max_content_boost[c]) ||
            metadata.min_content_boost[c] <= 0 || metadata.max_content_boost[c] < metadata.min_content_boost[c] ||
            !std::isfinite(metadata.gamma[c]) || metadata.gamma[c] != 1 ||
            !std::isfinite(metadata.offset_sdr[c]) || metadata.offset_sdr[c] < 0 ||
            !std::isfinite(metadata.offset_hdr[c]) || metadata.offset_hdr[c] < 0)
          throw std::runtime_error("Unsupported native gain metadata: require finite ordered boosts, gamma 1, and nonnegative offsets");
      }
      metadata.hdr_capacity_min = exp2(fraction(map->baseHdrHeadroom));
      metadata.hdr_capacity_max = exp2(fraction(map->alternateHdrHeadroom));
      metadata.use_base_cg = map->useBaseColorSpace;
      if (metadata.hdr_capacity_min != 1 || !std::isfinite(metadata.hdr_capacity_max) || metadata.hdr_capacity_max <= 1)
        throw std::runtime_error("JPEG packing requires an SDR base and positive alternate HDR headroom");
      Bytes base_data = read(argv[3]), map_data = read(argv[4]);
      check_jpeg(base_data, avif.get(), "Base");
      check_jpeg(map_data, map->image, "Map");
      auto base = image(base_data.data(), base_data.size());
      auto gain = image(map_data.data(), map_data.size());
      Encoder encoder(uhdr_create_encoder(), uhdr_release_encoder);
      if (!encoder) throw std::runtime_error("Cannot allocate native encoder");
      check(uhdr_enc_set_compressed_image(encoder.get(), &base, UHDR_BASE_IMG), "set native combined base");
      check(uhdr_enc_set_gainmap_image(encoder.get(), &gain, &metadata), "set native AVIF-computed map");
      check(uhdr_encode(encoder.get()), "pack native AVIF-computed map");
      const auto* output = uhdr_get_encoded_stream(encoder.get());
      if (!output) throw std::runtime_error("Native encoder returned no output");
      write(argv[5], output->data, output->data_sz);
      std::cout << "{\"libavif_version\":\"" << avifVersion() << "\",\"libultrahdr_version\":\"" << UHDR_LIB_VERSION_STR
                << "\",\"scope\":\"opaque RGB 8-bit base/map; native AVIF gamma-1 metadata; unchanged compressed JPEG samples\"}\n";
      return 0;
    }
    if (argc > 1 && std::string(argv[1]) == "regenerate-linear") {
      if (argc != 9) throw std::runtime_error("regenerate-linear gbrpf32 width height gamut base output source-headroom");
      Bytes raw = read(argv[2]), compressed_base = read(argv[6]);
      unsigned w = std::stoul(argv[3]), h = std::stoul(argv[4]);
      auto gamut = static_cast<uhdr_color_gamut_t>(std::stoi(argv[5]));
      if (raw.size() != size_t(w) * h * 12) throw std::runtime_error("Incorrect planar float size");
      // Storage conversion only: gain calculation, transfer/gamut work, and
      // clipping are performed by libultrahdr, not by this adapter.
      std::vector<float> values(raw.size() / sizeof(float));
      std::memcpy(values.data(), raw.data(), raw.size());
      for (float value : values) {
        if (!std::isfinite(value)) throw std::runtime_error("Nonfinite native HDR sample");
      }
      std::vector<uint16_t> rgba(size_t(w) * h * 4);
      size_t count = size_t(w) * h;
      for (size_t i = 0; i < count; ++i) {
        rgba[i * 4] = ultrahdr::floatToHalf(values[count * 2 + i]);
        rgba[i * 4 + 1] = ultrahdr::floatToHalf(values[i]);
        rgba[i * 4 + 2] = ultrahdr::floatToHalf(values[count + i]);
        rgba[i * 4 + 3] = ultrahdr::floatToHalf(1.0f);
      }
      uhdr_raw_image_t hdr{UHDR_IMG_FMT_64bppRGBAHalfFloat, gamut, UHDR_CT_LINEAR,
                           UHDR_CR_FULL_RANGE, w, h, {rgba.data(), nullptr, nullptr}, {w, 0, 0}};
      auto base = image(compressed_base.data(), compressed_base.size());
      Encoder encoder(uhdr_create_encoder(), uhdr_release_encoder);
      if (!encoder) throw std::runtime_error("Cannot allocate native encoder");
      check(uhdr_enc_set_raw_image(encoder.get(), &hdr, UHDR_HDR_IMG), "set raw HDR intent");
      check(uhdr_enc_set_compressed_image(encoder.get(), &base, UHDR_SDR_IMG), "set authored SDR intent");
      check(uhdr_enc_set_gainmap_scale_factor(encoder.get(), 1), "set map scale");
      check(uhdr_enc_set_using_multi_channel_gainmap(encoder.get(), 1), "set map RGB");
      check(uhdr_enc_set_quality(encoder.get(), 100, UHDR_GAIN_MAP_IMG), "set map quality");
      check(uhdr_enc_set_preset(encoder.get(), UHDR_USAGE_BEST_QUALITY), "set quality preset");
      check(uhdr_enc_set_target_display_peak_brightness(encoder.get(), std::stof(argv[8]) * 203), "set source display headroom");
      check(uhdr_encode(encoder.get()), "regenerate gain map");
      const auto* result = uhdr_get_encoded_stream(encoder.get());
      if (!result) throw std::runtime_error("No encoded result");
      write(argv[7], result->data, result->data_sz);
      std::cout << "{}\n";
      return 0;
    }
    if (argc < 3) throw std::runtime_error("Usage: hdr-proof-uhdr probe input | extract input base map | roundtrip input output | pack metadata-source base map output");
    const std::string mode(argv[1]);
    const bool decode = mode == "decode-linear" && (argc == 4 || argc == 5);
    const bool probe = mode == "probe" && argc == 3;
    const bool extract = mode == "extract" && argc == 5;
    const bool roundtrip = mode == "roundtrip" && argc == 4;
    const bool pack = mode == "pack" && argc == 6;
    if (!(decode || probe || extract || roundtrip || pack)) throw std::runtime_error("Invalid operation or argument count");
    Bytes input = read(argv[2]);
    auto compressed = image(input.data(), input.size());
    Decoder decoder(uhdr_create_decoder(), uhdr_release_decoder);
    if (!decoder) throw std::runtime_error("Cannot allocate native decoder");
    check(uhdr_dec_set_image(decoder.get(), &compressed), "set source");
    if (decode) {
      float requested_boost = 0;
      if (argc == 5) {
        size_t consumed = 0;
        requested_boost = std::stof(argv[4], &consumed);
        if (consumed != std::string(argv[4]).size() || !std::isfinite(requested_boost) || requested_boost < 1)
          throw std::runtime_error("Display boost must be finite and at least one");
        check(uhdr_dec_set_out_max_display_boost(decoder.get(), requested_boost), "set display boost");
      }
      check(uhdr_dec_set_out_img_format(decoder.get(), UHDR_IMG_FMT_64bppRGBAHalfFloat), "set HDR float format");
      check(uhdr_dec_set_out_color_transfer(decoder.get(), UHDR_CT_LINEAR), "set HDR linear transfer");
      check(uhdr_decode(decoder.get()), "decode HDR intent");
      auto* decoded = uhdr_get_decoded_image(decoder.get());
      if (!decoded) throw std::runtime_error("No decoded HDR");
      std::ofstream stream(argv[3], std::ios::binary);
      const uint16_t* data = static_cast<const uint16_t*>(decoded->planes[0]);
      for (unsigned channel : {1, 2, 0}) {
        for (unsigned row = 0; row < decoded->h; ++row) {
          for (unsigned column = 0; column < decoded->w; ++column) {
            float value = ultrahdr::halfToFloat(data[(size_t(row) * decoded->stride[0] + column) * 4 + channel]);
            stream.write(reinterpret_cast<const char*>(&value), sizeof(value));
          }
        }
      }
      if (!stream) throw std::runtime_error("Cannot write decoded HDR");
      std::cout << std::setprecision(9) << "{\"width\":" << decoded->w << ",\"height\":" << decoded->h
                << ",\"gamut\":" << decoded->cg << ",\"headroom\":" << uhdr_dec_get_gainmap_metadata(decoder.get())->hdr_capacity_max
                << ",\"requested_display_boost\":";
      if (requested_boost) std::cout << requested_boost;
      else std::cout << "null";
      std::cout << "}\n";
      return 0;
    }
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

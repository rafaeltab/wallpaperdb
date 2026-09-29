// Isolated proof adapter. Actual JPEG ICC bytes drive LittleCMS float32
// linearization; native libavif and libultrahdr retain gain-map mathematics.
#include <lcms2.h>
#include <avif/avif.h>
#include <png.h>
#include <cstdio>
#include <csetjmp>
#include <jpeglib.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include "ultrahdr_api.h"
#include "ultrahdr/gainmapmath.h"

extern "C" avifResult avifProofComputeGainMapLinearBase(const avifRGBImage*, avifColorPrimaries,
    const float*, size_t, const avifRGBImage*, avifTransferCharacteristics, avifGainMap*, avifDiagnostics*);

using Bytes = std::vector<unsigned char>;
using Profile = std::unique_ptr<void, decltype(&cmsCloseProfile)>;
using Transform = std::unique_ptr<void, decltype(&cmsDeleteTransform)>;

static Bytes read(const char* path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) throw std::runtime_error("Cannot read input");
  return Bytes(std::istreambuf_iterator<char>(stream), {});
}
static void write(const char* path, const void* data, size_t length) {
  std::ofstream stream(path, std::ios::binary);
  stream.write(static_cast<const char*>(data), length);
  if (!stream) throw std::runtime_error("Cannot write output");
}
static unsigned be32(const unsigned char* p) {
  return unsigned(p[0]) << 24 | unsigned(p[1]) << 16 | unsigned(p[2]) << 8 | unsigned(p[3]);
}
struct JpegError { jpeg_error_mgr manager; std::jmp_buf jump; char text[JMSG_LENGTH_MAX]; };
static void jpeg_error(j_common_ptr decoder) {
  auto* error = reinterpret_cast<JpegError*>(decoder->err);
  decoder->err->format_message(decoder, error->text);
  std::longjmp(error->jump, 1);
}
struct Raster { unsigned width = 0, height = 0; Bytes pixels, icc; };
static Raster jpeg(const Bytes& data) {
  Raster result;
  jpeg_decompress_struct decoder{};
  JpegError error{};
  decoder.err = jpeg_std_error(&error.manager);
  error.manager.error_exit = jpeg_error;
  if (setjmp(error.jump)) {
    jpeg_destroy_decompress(&decoder);
    throw std::runtime_error(std::string("JPEG: ") + error.text);
  }
  jpeg_create_decompress(&decoder);
  jpeg_mem_src(&decoder, data.data(), data.size());
  jpeg_save_markers(&decoder, JPEG_APP0 + 2, 65535);
  jpeg_read_header(&decoder, TRUE);
  if (decoder.data_precision != 8 || decoder.num_components != 3 || decoder.jpeg_color_space != JCS_RGB ||
      !decoder.image_width || !decoder.image_height || decoder.image_width > 4096 || decoder.image_height > 4096) {
    jpeg_destroy_decompress(&decoder);
    throw std::runtime_error("Bounded RGB8 JPEG required");
  }
  std::vector<Bytes> chunks;
  unsigned expected = 0;
  for (auto* marker = decoder.marker_list; marker; marker = marker->next) {
    if (marker->marker != JPEG_APP0 + 2 || marker->data_length < 12 ||
        std::memcmp(marker->data, "ICC_PROFILE\0", 12)) continue;
    if (marker->data_length < 14 || !marker->data[12] || !marker->data[13])
      throw std::runtime_error("Invalid ICC chunk");
    if (!expected) { expected = marker->data[13]; chunks.resize(expected); }
    unsigned index = marker->data[12] - 1;
    if (marker->data[13] != expected || index >= expected || !chunks[index].empty())
      throw std::runtime_error("Duplicate or conflicting ICC chunks");
    chunks[index] = Bytes(marker->data + 14, marker->data + marker->data_length);
  }
  for (const auto& chunk : chunks) {
    if (chunk.empty()) throw std::runtime_error("Missing ICC chunk");
    result.icc.insert(result.icc.end(), chunk.begin(), chunk.end());
  }
  decoder.out_color_space = JCS_RGB;
  decoder.dct_method = JDCT_ISLOW;
  jpeg_start_decompress(&decoder);
  result.width = decoder.output_width; result.height = decoder.output_height;
  result.pixels.resize(size_t(result.width) * result.height * 3);
  while (decoder.output_scanline < decoder.output_height) {
    JSAMPROW row = result.pixels.data() + size_t(decoder.output_scanline) * result.width * 3;
    jpeg_read_scanlines(&decoder, &row, 1);
  }
  jpeg_finish_decompress(&decoder);
  bool warning = decoder.err->num_warnings != 0;
  jpeg_destroy_decompress(&decoder);
  if (warning) throw std::runtime_error("JPEG decoder warning");
  return result;
}

static Profile canonical(bool p3) {
  cmsCIExyY white{.3127, .329, 1};
  cmsCIExyYTRIPLE primaries = p3 ? cmsCIExyYTRIPLE{{.68,.32,1},{.265,.69,1},{.15,.06,1}}
                                : cmsCIExyYTRIPLE{{.64,.33,1},{.30,.60,1},{.15,.06,1}};
  cmsToneCurve* curve = cmsBuildGamma(nullptr, 1);
  cmsToneCurve* curves[] = {curve, curve, curve};
  Profile result(cmsCreateRGBProfile(&white, &primaries, curves), cmsCloseProfile);
  cmsFreeToneCurve(curve);
  if (!result) throw std::runtime_error("Cannot construct native linear ICC");
  return result;
}
static bool xyz_equal(const cmsCIEXYZ* a, const cmsCIEXYZ* b) {
  return a && b && std::abs(a->X-b->X) <= 2./65536 && std::abs(a->Y-b->Y) <= 2./65536 &&
         std::abs(a->Z-b->Z) <= 2./65536;
}
struct Linear { std::vector<float> pixels; std::string gamut; double gamma; };
static Linear linearize(const Raster& raster) {
  const Bytes& bytes = raster.icc;
  if (bytes.size() < 132 || be32(bytes.data()) != bytes.size() || bytes[8] != 4 ||
      std::memcmp(bytes.data()+12, "mntrRGB XYZ ", 12) || std::memcmp(bytes.data()+36, "acsp", 4) ||
      be32(bytes.data()+44) != 0 || be32(bytes.data()+68) != 0x0000f6d6 ||
      be32(bytes.data()+72) != 0x00010000 || be32(bytes.data()+76) != 0x0000d32d)
    throw std::runtime_error("Unsupported or missing ICC header");
  const unsigned count = be32(bytes.data()+128);
  if (count > 64 || 132 + count*12 > bytes.size()) throw std::runtime_error("Invalid ICC table");
  std::set<unsigned> names;
  const std::set<unsigned> allowed{cmsSigProfileDescriptionTag, cmsSigCopyrightTag, cmsSigMediaWhitePointTag,
    cmsSigChromaticAdaptationTag, cmsSigRedColorantTag, cmsSigGreenColorantTag, cmsSigBlueColorantTag,
    cmsSigRedTRCTag, cmsSigGreenTRCTag, cmsSigBlueTRCTag, cmsSigChromaticityTag};
  for (unsigned i = 0; i < count; ++i) {
    const unsigned char* tag = bytes.data()+132+i*12;
    unsigned name=be32(tag), offset=be32(tag+4), length=be32(tag+8);
    if (!allowed.count(name) || !names.insert(name).second || offset < 132+count*12 ||
        offset > bytes.size() || length > bytes.size()-offset)
      throw std::runtime_error("Unsupported, duplicate, or truncated ICC tag");
    if (name == cmsSigRedTRCTag || name == cmsSigGreenTRCTag || name == cmsSigBlueTRCTag) {
      if (length != 16 || std::memcmp(bytes.data()+offset, "para", 4) ||
          bytes[offset+8] || bytes[offset+9]) throw std::runtime_error("Expected ICC type-0 parametric TRC");
    }
  }
  Profile profile(cmsOpenProfileFromMem(bytes.data(), bytes.size()), cmsCloseProfile);
  Profile output(cmsOpenProfileFromMem(bytes.data(), bytes.size()), cmsCloseProfile);
  if (!profile || !output) throw std::runtime_error("Native ICC profile parse failed");
  Linear result;
  for (auto tag : {cmsSigRedTRCTag, cmsSigGreenTRCTag, cmsSigBlueTRCTag}) {
    auto* curve = static_cast<cmsToneCurve*>(cmsReadTag(profile.get(), tag));
    if (!curve || cmsGetToneCurveParametricType(curve) != 1)
      throw std::runtime_error("Only ICC type-0 gamma curves are supported");
    const cmsCurveSegment* segment = cmsGetToneCurveSegment(0, curve);
    if (!segment) throw std::runtime_error("ICC curve has no native parametric segment");
    result.gamma = segment->Params[0];
    if (!std::isfinite(result.gamma) || std::abs(result.gamma-3.2) > 1./65536)
      throw std::runtime_error("ICC transfer is outside the gamma3.2 experiment");
  }
  for (bool p3 : {false, true}) {
    auto known = canonical(p3);
    bool match = true;
    for (auto tag : {cmsSigRedColorantTag, cmsSigGreenColorantTag, cmsSigBlueColorantTag, cmsSigMediaWhitePointTag})
      match &= xyz_equal(static_cast<const cmsCIEXYZ*>(cmsReadTag(profile.get(), tag)),
                         static_cast<const cmsCIEXYZ*>(cmsReadTag(known.get(), tag)));
    Bytes source_chad(44), known_chad(44);
    match &= cmsReadRawTag(profile.get(), cmsSigChromaticAdaptationTag, source_chad.data(), 44) == 44 &&
             cmsReadRawTag(known.get(), cmsSigChromaticAdaptationTag, known_chad.data(), 44) == 44 && source_chad == known_chad;
    if (match) result.gamut = p3 ? "p3" : "srgb";
  }
  if (result.gamut.empty()) throw std::runtime_error("ICC gamut is outside the known matrix profiles");
  cmsToneCurve* one = cmsBuildGamma(nullptr, 1);
  for (auto tag : {cmsSigRedTRCTag, cmsSigGreenTRCTag, cmsSigBlueTRCTag}) {
    if (!cmsWriteTag(output.get(), tag, one)) throw std::runtime_error("Cannot linearize native ICC destination");
  }
  cmsFreeToneCurve(one);
  Transform transform(cmsCreateTransform(profile.get(), TYPE_RGB_8, output.get(), TYPE_RGB_FLT,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOOPTIMIZE | cmsFLAGS_NOCACHE), cmsDeleteTransform);
  if (!transform) throw std::runtime_error("Native ICC transform failed");
  result.pixels.resize(raster.pixels.size());
  cmsDoTransform(transform.get(), raster.pixels.data(), result.pixels.data(), raster.width*raster.height);
  for (float value : result.pixels)
    if (!std::isfinite(value) || value < -1e-7 || value > 1.000001)
      throw std::runtime_error("Native ICC produced unsupported linear samples");
  return result;
}
static void describe(const Raster& raster, const Linear& linear) {
  std::cout << std::setprecision(10) << "{\"width\":" << raster.width << ",\"height\":" << raster.height
    << ",\"gamut\":\"" << linear.gamut << "\",\"gamma\":" << linear.gamma
    << ",\"base_depth\":8,\"lcms_version\":" << cmsGetEncodedCMMversion()
    << ",\"libavif_version\":\"" << avifVersion() << "\",\"libultrahdr_version\":\"" << UHDR_LIB_VERSION_STR
    << "\",\"precision\":\"actual ICC to float32 linear RGB in its own primaries\"}\n";
}
static void check(avifResult status, const avifDiagnostics& diag) {
  if (status != AVIF_RESULT_OK) throw std::runtime_error(std::string(avifResultToString(status))+": "+diag.error);
}
static void check(uhdr_error_info_t status) {
  if (status.error_code != UHDR_CODEC_OK) throw std::runtime_error(status.detail);
}
static void compute(const Raster& raster, const Linear& linear, const char* pq_path, const char* output) {
  const Bytes png_bytes = read(pq_path);
  unsigned cicp_count = 0;
  if (png_bytes.size() < 8 || png_sig_cmp(png_bytes.data(), 0, 8)) throw std::runtime_error("Expected HDR PNG");
  for (size_t position = 8; position+12 <= png_bytes.size();) {
    unsigned length = be32(png_bytes.data()+position);
    if (length > png_bytes.size()-position-12) throw std::runtime_error("Truncated HDR PNG chunk");
    if (!std::memcmp(png_bytes.data()+position+4, "cICP", 4)) {
      const Bytes expected{static_cast<unsigned char>(linear.gamut == "p3" ? 12 : 1), 16, 0, 1};
      if (++cicp_count != 1 || length != 4 || !std::equal(expected.begin(), expected.end(), png_bytes.data()+position+8))
        throw std::runtime_error("HDR PNG must signal matching primaries, PQ, identity matrix, full range");
    }
    if (!std::memcmp(png_bytes.data()+position+4, "iCCP", 4) || !std::memcmp(png_bytes.data()+position+4, "sRGB", 4))
      throw std::runtime_error("Conflicting HDR PNG color profile");
    position += length+12;
  }
  if (cicp_count != 1) throw std::runtime_error("HDR PNG cICP facts missing");
  FILE* file = std::fopen(pq_path, "rb");
  if (!file) throw std::runtime_error("Cannot open HDR PNG");
  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, nullptr, nullptr, nullptr);
  png_infop info = png ? png_create_info_struct(png) : nullptr;
  std::vector<unsigned short> pq(size_t(raster.width)*raster.height*3);
  if (!png || !info || setjmp(png_jmpbuf(png))) {
    png_destroy_read_struct(&png, &info, nullptr); std::fclose(file);
    throw std::runtime_error("Native HDR PNG decode failed");
  }
  png_init_io(png, file);
  png_set_crc_action(png, PNG_CRC_ERROR_QUIT, PNG_CRC_ERROR_QUIT);
  png_read_png(png, info, PNG_TRANSFORM_SWAP_ENDIAN, nullptr);
  if (png_get_bit_depth(png, info) != 16 || png_get_color_type(png, info) != PNG_COLOR_TYPE_RGB ||
      png_get_image_width(png, info) != raster.width || png_get_image_height(png, info) != raster.height) {
    png_destroy_read_struct(&png, &info, nullptr); std::fclose(file);
    throw std::runtime_error("HDR intent must be matching RGB16 PQ PNG");
  }
  auto rows = png_get_rows(png, info);
  for (unsigned y = 0; y < raster.height; ++y)
    std::memcpy(pq.data()+size_t(y)*raster.width*3, rows[y], size_t(raster.width)*6);
  png_destroy_read_struct(&png, &info, nullptr); std::fclose(file);
  using Image = std::unique_ptr<avifImage, decltype(&avifImageDestroy)>;
  Image base(avifImageCreate(raster.width, raster.height, 8, AVIF_PIXEL_FORMAT_YUV444), avifImageDestroy);
  if (!base) throw std::runtime_error("Cannot allocate native AVIF");
  base->colorPrimaries = linear.gamut == "p3" ? AVIF_COLOR_PRIMARIES_SMPTE432 : AVIF_COLOR_PRIMARIES_BT709;
  base->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_UNSPECIFIED;
  base->matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_IDENTITY;
  avifDiagnostics diag{};
  avifRGBImage rgb{}; avifRGBImageSetDefaults(&rgb, base.get());
  rgb.format = AVIF_RGB_FORMAT_RGB; rgb.pixels = const_cast<unsigned char*>(raster.pixels.data());
  rgb.rowBytes = raster.width*3;
  check(avifImageRGBToYUV(base.get(), &rgb), diag);
  check(avifImageSetProfileICC(base.get(), raster.icc.data(), raster.icc.size()), diag);
  avifRGBImage alternate = rgb;
  alternate.depth = 16; alternate.pixels = reinterpret_cast<unsigned char*>(pq.data());
  alternate.rowBytes = raster.width*6;
  base->gainMap = avifGainMapCreate();
  if (!base->gainMap) throw std::runtime_error("Cannot allocate native gain map");
  base->gainMap->image = avifImageCreate(raster.width, raster.height, 8, AVIF_PIXEL_FORMAT_YUV444);
  base->gainMap->image->matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_IDENTITY;
  check(avifProofComputeGainMapLinearBase(&rgb, base->colorPrimaries, linear.pixels.data(), linear.pixels.size(),
      &alternate, AVIF_TRANSFER_CHARACTERISTICS_SMPTE2084, base->gainMap, &diag), diag);
  base->gainMap->altColorPrimaries = base->colorPrimaries;
  base->gainMap->altTransferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_SMPTE2084;
  base->gainMap->altMatrixCoefficients = AVIF_MATRIX_COEFFICIENTS_IDENTITY;
  base->gainMap->altDepth = 12;
  base->gainMap->altPlaneCount = 3;
  using Encoder = std::unique_ptr<avifEncoder, decltype(&avifEncoderDestroy)>;
  Encoder encoder(avifEncoderCreate(), avifEncoderDestroy);
  encoder->quality = 100; encoder->qualityGainMap = 100; encoder->speed = 10; encoder->maxThreads = 1;
  avifRWData encoded = AVIF_DATA_EMPTY;
  avifResult status = avifEncoderWrite(encoder.get(), base.get(), &encoded);
  if (status != AVIF_RESULT_OK) { avifRWDataFree(&encoded); check(status, encoder->diag); }
  write(output, encoded.data, encoded.size); avifRWDataFree(&encoded);
}
static Linear decode(const Bytes& bytes, Raster& raster, float boost) {
  using Decoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_decoder)>;
  Decoder decoder(uhdr_create_decoder(), uhdr_release_decoder);
  auto compressed = uhdr_compressed_image_t{const_cast<unsigned char*>(bytes.data()), bytes.size(), bytes.size(),
      UHDR_CG_UNSPECIFIED, UHDR_CT_UNSPECIFIED, UHDR_CR_UNSPECIFIED};
  check(uhdr_dec_set_image(decoder.get(), &compressed)); check(uhdr_dec_probe(decoder.get()));
  const auto* base = uhdr_dec_get_base_image(decoder.get());
  const auto* map = uhdr_dec_get_gainmap_image(decoder.get());
  const auto* metadata = uhdr_dec_get_gainmap_metadata(decoder.get());
  if (!base || !map || !metadata) throw std::runtime_error("Native gain metadata missing");
  auto metadata_copy = *metadata;
  ultrahdr::uhdr_gainmap_metadata_ext_t gain(metadata_copy, ultrahdr::kJpegrVersion);
  check(ultrahdr::uhdr_validate_gainmap_metadata_descriptor(&gain));
  if (!gain.use_base_cg || gain.hdr_capacity_min != 1 || gain.hdr_capacity_max <= 1)
    throw std::runtime_error("Only SDR base gain application in its own primaries is supported");
  const auto* bp = static_cast<const unsigned char*>(base->data);
  const auto* mp = static_cast<const unsigned char*>(map->data);
  raster = jpeg(Bytes(bp, bp+base->data_sz));
  Raster gain_raster = jpeg(Bytes(mp, mp+map->data_sz));
  if (gain_raster.width != raster.width || gain_raster.height != raster.height || !gain_raster.icc.empty())
    throw std::runtime_error("Only matching RGB8 gain maps without display ICC are supported");
  Linear result = linearize(raster);
  const float weight = std::clamp(std::log2(std::min(boost, gain.hdr_capacity_max))/std::log2(gain.hdr_capacity_max), 0.f, 1.f);
  for (size_t i = 0; i < result.pixels.size(); i += 3) {
    ultrahdr::Color base_color{result.pixels[i], result.pixels[i+1], result.pixels[i+2]};
    ultrahdr::Color gain_color{gain_raster.pixels[i]/255.f, gain_raster.pixels[i+1]/255.f, gain_raster.pixels[i+2]/255.f};
    auto hdr = weight == 0 ? base_color : ultrahdr::applyGain(base_color, gain_color, &gain, weight);
    if (!std::isfinite(hdr.r) || !std::isfinite(hdr.g) || !std::isfinite(hdr.b))
      throw std::runtime_error("Nonfinite native HDR result");
    result.pixels[i] = std::max(0.f, hdr.r); result.pixels[i+1] = std::max(0.f, hdr.g); result.pixels[i+2] = std::max(0.f, hdr.b);
  }
  return result;
}
static void pack_fractional_gamma(const char* avif_path, const char* base_path, const char* map_path, const char* output,
                                  float expected_gamma, float expected_offset) {
  using Image = std::unique_ptr<avifImage, decltype(&avifImageDestroy)>;
  using Decoder = std::unique_ptr<avifDecoder, decltype(&avifDecoderDestroy)>;
  Image intent(avifImageCreateEmpty(), avifImageDestroy);
  Decoder decoder(avifDecoderCreate(), avifDecoderDestroy);
  if (!intent || !decoder) throw std::runtime_error("Cannot allocate native gain-map decoder");
  decoder->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL;
  check(avifDecoderReadFile(decoder.get(), intent.get(), avif_path), decoder->diag);
  const auto* map = intent->gainMap;
  if (!map || !map->image || intent->depth != 8 || map->image->depth != 8 || !map->useBaseColorSpace ||
      intent->yuvFormat != AVIF_PIXEL_FORMAT_YUV444 || map->image->yuvFormat != AVIF_PIXEL_FORMAT_YUV444 ||
      intent->alphaPlane || map->image->alphaPlane || intent->transformFlags || map->image->transformFlags)
    throw std::runtime_error("Native packing requires opaque RGB8 base/map and identity orientation");
  const auto fraction = [](auto value) {
    if (!value.d) throw std::runtime_error("Invalid gain-map fraction");
    return static_cast<float>(value.n)/value.d;
  };
  uhdr_gainmap_metadata_t metadata{};
  for (unsigned channel = 0; channel < 3; ++channel) {
    metadata.min_content_boost[channel] = std::exp2(fraction(map->gainMapMin[channel]));
    metadata.max_content_boost[channel] = std::exp2(fraction(map->gainMapMax[channel]));
    metadata.gamma[channel] = fraction(map->gainMapGamma[channel]);
    metadata.offset_sdr[channel] = fraction(map->baseOffset[channel]);
    metadata.offset_hdr[channel] = fraction(map->alternateOffset[channel]);
    if (metadata.gamma[channel] != expected_gamma || metadata.offset_sdr[channel] != expected_offset ||
        metadata.offset_hdr[channel] != expected_offset)
      throw std::runtime_error("Native packing requires the selected gamma/offset metadata");
  }
  metadata.hdr_capacity_min = std::exp2(fraction(map->baseHdrHeadroom));
  metadata.hdr_capacity_max = std::exp2(fraction(map->alternateHdrHeadroom));
  metadata.use_base_cg = map->useBaseColorSpace;
  ultrahdr::uhdr_gainmap_metadata_ext_t validated(metadata, ultrahdr::kJpegrVersion);
  check(ultrahdr::uhdr_validate_gainmap_metadata_descriptor(&validated));
  if (metadata.hdr_capacity_min != 1 || metadata.hdr_capacity_max <= 1)
    throw std::runtime_error("Native packing requires forward SDR-base gain application");
  Bytes base_bytes = read(base_path), map_bytes = read(map_path);
  const Raster base = jpeg(base_bytes), gain = jpeg(map_bytes);
  const Linear color = linearize(base);
  if (base.width != intent->width || base.height != intent->height || gain.width != map->image->width ||
      gain.height != map->image->height || gain.width != base.width || gain.height != base.height || !gain.icc.empty() ||
      base.icc.size() != intent->icc.size || std::memcmp(base.icc.data(), intent->icc.data, base.icc.size()))
    throw std::runtime_error("Compressed base/map facts disagree with the native AVIF intent");
  auto base_image = uhdr_compressed_image_t{base_bytes.data(), base_bytes.size(), base_bytes.size(),
      UHDR_CG_UNSPECIFIED, UHDR_CT_UNSPECIFIED, UHDR_CR_UNSPECIFIED};
  auto gain_image = uhdr_compressed_image_t{map_bytes.data(), map_bytes.size(), map_bytes.size(),
      UHDR_CG_UNSPECIFIED, UHDR_CT_UNSPECIFIED, UHDR_CR_UNSPECIFIED};
  using Encoder = std::unique_ptr<uhdr_codec_private_t, decltype(&uhdr_release_encoder)>;
  Encoder encoder(uhdr_create_encoder(), uhdr_release_encoder);
  if (!encoder) throw std::runtime_error("Cannot allocate native gain-map encoder");
  check(uhdr_enc_set_compressed_image(encoder.get(), &base_image, UHDR_BASE_IMG));
  check(uhdr_enc_set_gainmap_image(encoder.get(), &gain_image, &metadata));
  check(uhdr_encode(encoder.get()));
  const auto* stream = uhdr_get_encoded_stream(encoder.get());
  if (!stream) throw std::runtime_error("Native gain-map encoder produced no bytes");
  write(output, stream->data, stream->data_sz);
  describe(base, color);
}
int main(int argc, char** argv) {
  try {
    const std::string mode = argc > 1 ? argv[1] : "";
    if (mode == "pack-gamma2" && argc == 6) {
      pack_fractional_gamma(argv[2], argv[3], argv[4], argv[5], 2, 1.f/65536); return 0;
    }
    if (mode == "pack-gamma2-midpoint" && argc == 6) {
      pack_fractional_gamma(argv[2], argv[3], argv[4], argv[5], 2, 1.f/16384); return 0;
    }
    if (mode == "pack-gamma15-midpoint" && argc == 6) {
      pack_fractional_gamma(argv[2], argv[3], argv[4], argv[5], 1.5f, 1.f/16384); return 0;
    }
    if (mode == "jpeg-samples" && argc == 4) {
      auto raster = jpeg(read(argv[2]));
      write(argv[3], raster.pixels.data(), raster.pixels.size());
      std::cout << "{\"width\":" << raster.width << ",\"height\":" << raster.height
        << ",\"depth\":8,\"scope\":\"Unmanaged native JPEG sample diagnostic only\"}\n";
      return 0;
    }
    if (mode == "decode" && argc == 5) {
      size_t consumed = 0; float boost = std::stof(argv[4], &consumed);
      if (consumed != std::string(argv[4]).size() || !std::isfinite(boost) || boost < 1)
        throw std::runtime_error("Display boost must be finite and at least one");
      Raster raster; auto linear = decode(read(argv[2]), raster, boost);
      write(argv[3], linear.pixels.data(), linear.pixels.size()*sizeof(float));
      describe(raster, linear); return 0;
    }
    if (!((mode == "linearize" && argc == 4) || (mode == "compute" && argc == 5)))
      throw std::runtime_error("linearize input.jpg output.rgbf32; compute base.jpg pq.png output.avif; decode input.jpg output.rgbf32 boost");
    auto raster = jpeg(read(argv[2]));
    auto linear = linearize(raster);
    if (mode == "compute") compute(raster, linear, argv[3], argv[4]);
    else write(argv[3], linear.pixels.data(), linear.pixels.size()*sizeof(float));
    describe(raster, linear);
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}

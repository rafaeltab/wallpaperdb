/* Proof-only libpng reader. Emits width/height/source depth then raw RGBA16LE.
 * No gamma, gamut or alpha arithmetic: samples retain their encoded values.
 */
#include <png.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    FILE *file = fopen(argv[1], "rb");
    if (!file) return 2;
    png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (!png) { fclose(file); return 2; }
    png_infop info = png_create_info_struct(png);
    if (!info) { png_destroy_read_struct(&png, NULL, NULL); fclose(file); return 2; }
    if (setjmp(png_jmpbuf(png))) { png_destroy_read_struct(&png, &info, NULL); fclose(file); return 1; }
    png_init_io(png, file);
    png_read_info(png, info);
    png_uint_32 width = png_get_image_width(png, info);
    png_uint_32 height = png_get_image_height(png, info);
    int depth = png_get_bit_depth(png, info);
    int color = png_get_color_type(png, info);
    if (!width || !height || width > 8192 || height > 8192) png_error(png, "Proof image exceeds bounds");
    if (color == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
    if (color == PNG_COLOR_TYPE_GRAY && depth < 8) png_set_expand_gray_1_2_4_to_8(png);
    int transparency = png_get_valid(png, info, PNG_INFO_tRNS);
    if (transparency) png_set_tRNS_to_alpha(png);
    if (depth < 16) png_set_expand_16(png);
    if (color == PNG_COLOR_TYPE_GRAY || color == PNG_COLOR_TYPE_GRAY_ALPHA) png_set_gray_to_rgb(png);
    if (!(color & PNG_COLOR_MASK_ALPHA) && !transparency) png_set_add_alpha(png, 65535, PNG_FILLER_AFTER);
    png_set_swap(png); /* The proof image pins linux/amd64, a little-endian target. */
    png_set_interlace_handling(png);
    png_read_update_info(png, info);
    size_t stride = png_get_rowbytes(png, info);
    if (stride != (size_t)width * 8) png_error(png, "Expected RGBA16");
    png_bytep data = malloc(stride * height);
    png_bytepp rows = malloc(sizeof(png_bytep) * height);
    if (!data || !rows) png_error(png, "Allocation failed");
    for (png_uint_32 y = 0; y < height; ++y) rows[y] = data + y * stride;
    png_read_image(png, rows);
    png_read_end(png, NULL);
    uint32_t header[3] = {width, height, (uint32_t)depth};
    int ok = fwrite(header, sizeof(header), 1, stdout) == 1 && fwrite(data, stride, height, stdout) == height;
    free(rows);
    free(data);
    png_destroy_read_struct(&png, &info, NULL);
    fclose(file);
    return ok ? 0 : 1;
}

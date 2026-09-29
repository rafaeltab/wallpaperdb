/* Proof-only planar float I/O around zimg's native fractional-window resizer. */
#include "zimg.h"
#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static void fail(const char *context) {
    char message[1024] = {0};
    zimg_get_last_error(message, sizeof(message));
    fprintf(stderr, "%s: %s\n", context, message);
    exit(1);
}

static double number(const char *text) {
    char *end = NULL;
    errno = 0;
    double result = strtod(text, &end);
    if (errno || !end || *end || !isfinite(result)) fail("Invalid numeric argument");
    return result;
}

static unsigned dimension(const char *text) {
    double value = number(text);
    if (value < 1 || value > 16384 || floor(value) != value) fail("Invalid dimension");
    return (unsigned)value;
}

int main(int argc, char **argv) {
    if (argc != 11) {
        fprintf(stderr, "input output width height out-width out-height left top region-width region-height\n");
        return 2;
    }
    unsigned width = dimension(argv[3]), height = dimension(argv[4]);
    unsigned out_width = dimension(argv[5]), out_height = dimension(argv[6]);
    double left = number(argv[7]), top = number(argv[8]);
    double region_width = number(argv[9]), region_height = number(argv[10]);
    if (left < 0 || top < 0 || region_width <= 0 || region_height <= 0 ||
        left + region_width > width || top + region_height > height) fail("Invalid active region");
    size_t input_stride = ((size_t)width * 4 + 31) / 32 * 32;
    size_t output_stride = ((size_t)out_width * 4 + 31) / 32 * 32;
    size_t input_size = input_stride * height, output_size = output_stride * out_height;
    if (input_size > SIZE_MAX / 3 || output_size > SIZE_MAX / 3) fail("Image allocation overflow");
    void *input = aligned_alloc(32, input_size * 3);
    void *output = aligned_alloc(32, output_size * 3);
    if (!input || !output) fail("Image allocation");
    FILE *file = fopen(argv[1], "rb");
    if (!file) fail("Open input");
    for (unsigned channel = 0; channel < 3; ++channel)
        for (unsigned y = 0; y < height; ++y)
            if (fread((char *)input + channel * input_size + y * input_stride, 4, width, file) != width)
                fail("Truncated planar float input");
    if (fgetc(file) != EOF || ferror(file)) fail("Unexpected planar float input length");
    fclose(file);
    zimg_image_format source, destination;
    zimg_image_format_default(&source, ZIMG_API_VERSION);
    zimg_image_format_default(&destination, ZIMG_API_VERSION);
    source.width = width; source.height = height;
    destination.width = out_width; destination.height = out_height;
    source.pixel_type = destination.pixel_type = ZIMG_PIXEL_FLOAT;
    source.color_family = destination.color_family = ZIMG_COLOR_RGB;
    source.active_region.left = left; source.active_region.top = top;
    source.active_region.width = region_width; source.active_region.height = region_height;
    zimg_graph_builder_params parameters;
    zimg_graph_builder_params_default(&parameters, ZIMG_API_VERSION);
    parameters.resample_filter = ZIMG_RESIZE_LANCZOS;
    parameters.filter_param_a = 3;
    parameters.cpu_type = ZIMG_CPU_NONE;
    zimg_filter_graph *graph = zimg_filter_graph_build(&source, &destination, &parameters);
    if (!graph) fail("Native window graph");
    size_t scratch_size = 0;
    if (zimg_filter_graph_get_tmp_size(graph, &scratch_size)) fail("Scratch size");
    void *scratch = aligned_alloc(32, (scratch_size + 31) / 32 * 32);
    if (!scratch && scratch_size) fail("Scratch allocation");
    zimg_image_buffer_const input_buffer = {0};
    zimg_image_buffer output_buffer = {0};
    input_buffer.version = output_buffer.version = ZIMG_API_VERSION;
    for (unsigned channel = 0; channel < 3; ++channel) {
        input_buffer.plane[channel].data = (char *)input + channel * input_size;
        input_buffer.plane[channel].stride = input_stride;
        input_buffer.plane[channel].mask = ZIMG_BUFFER_MAX;
        output_buffer.plane[channel].data = (char *)output + channel * output_size;
        output_buffer.plane[channel].stride = output_stride;
        output_buffer.plane[channel].mask = ZIMG_BUFFER_MAX;
    }
    if (zimg_filter_graph_process(graph, &input_buffer, &output_buffer, scratch,
                                  NULL, NULL, NULL, NULL)) fail("Native window process");
    file = fopen(argv[2], "wb");
    if (!file) fail("Open output");
    for (unsigned channel = 0; channel < 3; ++channel)
        for (unsigned y = 0; y < out_height; ++y)
            if (fwrite((char *)output + channel * output_size + y * output_stride, 4, out_width, file) != out_width)
                fail("Write planar float output");
    if (fclose(file)) fail("Close output");
    zimg_filter_graph_free(graph);
    free(scratch); free(input); free(output);
    return 0;
}

cmake_minimum_required(VERSION 3.16)
project(hdr_proof_jpegli LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Build the unmodified upstream JPEGli source list only. No JXL tools, bundled
# color management, test data, FetchContent, or replacement system libjpeg.
set(HWY_ENABLE_CONTRIB OFF CACHE BOOL "" FORCE)
set(HWY_ENABLE_EXAMPLES OFF CACHE BOOL "" FORCE)
set(HWY_ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(HWY_ENABLE_INSTALL OFF CACHE BOOL "" FORCE)
set(HWY_FORCE_STATIC_LIBS ON CACHE BOOL "" FORCE)
add_subdirectory("${JPEGLI_HIGHWAY_SOURCE}" highway)
find_package(Threads REQUIRED)
include("${JPEGLI_SOURCE}/lib/jxl_lists.cmake")
list(TRANSFORM JPEGXL_INTERNAL_JPEGLI_SOURCES PREPEND "${JPEGLI_SOURCE}/lib/")
add_library(proof-jpegli STATIC ${JPEGXL_INTERNAL_JPEGLI_SOURCES})
target_include_directories(proof-jpegli PUBLIC "${JPEGLI_SOURCE}" "${JPEGLI_SOURCE}/lib/include")
# jpeglib.h comes from the existing checksum-locked libjpeg-turbo-dev 3.1.3
# package. JPEGli exports jpegli_* names, so independent libjpeg stays intact.
target_link_libraries(proof-jpegli PUBLIC hwy Threads::Threads)
add_executable(hdr-proof-jpegli "${JPEGLI_HELPER_SOURCE}")
target_compile_options(hdr-proof-jpegli PRIVATE -Wall -Wextra -Werror)
target_link_libraries(hdr-proof-jpegli PRIVATE proof-jpegli)

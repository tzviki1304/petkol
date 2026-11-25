# Petkol native: whisper.cpp + a small JNI bridge (libpetkol_whisper.so).
cmake_minimum_required(VERSION 3.22.1)

# Always build optimized native code, even for the Gradle "debug" variant:
# a -O0 whisper is unusably slow.
set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS_RELEASE   "-O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")

project(petkol_whisper C CXX)

if (NOT WHISPER_DIR)
    message(FATAL_ERROR "WHISPER_DIR is not set (path to a whisper.cpp checkout)")
endif()
message(STATUS "Petkol: whisper.cpp from ${WHISPER_DIR}, ABI ${ANDROID_ABI}")

# Size: drop unused code/data.
add_compile_options(-ffunction-sections -fdata-sections)
add_link_options(-Wl,--gc-sections -Wl,--as-needed)

# ---- whisper.cpp / ggml options ----
set(BUILD_SHARED_LIBS        ON  CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS      OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES   OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER     OFF CACHE BOOL "" FORCE)
set(WHISPER_ALL_WARNINGS     OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL             OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2             OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE              OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP              OFF CACHE BOOL "" FORCE)   # ggml's own thread pool
set(GGML_LLAMAFILE           OFF CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI        OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS         OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES      OFF CACHE BOOL "" FORCE)

if (ANDROID_ABI STREQUAL "arm64-v8a")
    # Runtime CPU dispatch: ggml builds one CPU backend per ARM feature level
    # (armv8.0 NEON, armv8.2 +dotprod, +fp16, armv8.6 +i8mm, ...) as separate
    # libggml-cpu-android_*.so and picks the best one the device supports.
    # This keeps dotprod/fp16 paths on where available without SIGILL on
    # older Cortex-A53/A73 cores.
    set(GGML_BACKEND_DL       ON  CACHE BOOL "" FORCE)
    set(GGML_CPU_ALL_VARIANTS ON  CACHE BOOL "" FORCE)
    set(PETKOL_BACKEND_DL 1)
elseif (ANDROID_ABI STREQUAL "armeabi-v7a")
    set(GGML_BACKEND_DL       OFF CACHE BOOL "" FORCE)
    set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
    add_compile_options(-mfpu=neon-vfpv4)
    set(PETKOL_BACKEND_DL 0)
else() # x86_64 (emulator)
    set(GGML_BACKEND_DL       OFF CACHE BOOL "" FORCE)
    set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
    set(GGML_SSE42            ON  CACHE BOOL "" FORCE)
    set(PETKOL_BACKEND_DL 0)
endif()

# EXCLUDE_FROM_ALL: only what libpetkol_whisper needs gets built
# (ggml depends on the CPU backend variants, so those are built too).
add_subdirectory(${WHISPER_DIR} whisper_build EXCLUDE_FROM_ALL)

if (PETKOL_BACKEND_DL)
    # ggml writes the CPU variants to <build>/bin; move the ones we ship next to
    # our other .so files so the Android Gradle plugin packages them.
    # The armv9 (SVE/SME) variants are built but not shipped: armv9 phones run
    # the armv8.6 (+i8mm) variant fine, and this saves APK size.
    get_property(_ggml_targets DIRECTORY ${WHISPER_DIR}/ggml/src PROPERTY BUILDSYSTEM_TARGETS)
    foreach(t IN LISTS _ggml_targets)
        if (t MATCHES "^ggml-cpu-android_armv8")
            message(STATUS "Petkol: shipping CPU backend ${t}")
            set_target_properties(${t} PROPERTIES LIBRARY_OUTPUT_DIRECTORY ${CMAKE_LIBRARY_OUTPUT_DIRECTORY})
        endif()
    endforeach()
endif()

add_library(petkol_whisper SHARED petkol_whisper.cpp)
target_compile_definitions(petkol_whisper PRIVATE PETKOL_BACKEND_DL=${PETKOL_BACKEND_DL})
target_compile_options(petkol_whisper PRIVATE -fvisibility=hidden)
find_library(LOG_LIB log)
target_link_libraries(petkol_whisper PRIVATE whisper ggml ggml-base ${LOG_LIB})

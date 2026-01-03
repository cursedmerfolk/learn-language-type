#pragma once

// Shared integer/boolean types that work in both:
// - GBDK/SDCC builds (where gb/gb.h provides INT16/UINT8/etc)
// - Host-side GCC tests (where we provide compatible typedefs)

#if defined(__SDCC)
#include <gb/gb.h>
#else
#include <stdint.h>

typedef int8_t INT8;
typedef uint8_t UINT8;
typedef int16_t INT16;
typedef uint16_t UINT16;
typedef int32_t INT32;
typedef uint32_t UINT32;

// Match GBDK's BOOLEAN semantics (0/1 stored in a byte)
typedef uint8_t BOOLEAN;

#endif

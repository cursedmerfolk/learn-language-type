#pragma once

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

typedef uint8_t BOOLEAN;

#endif

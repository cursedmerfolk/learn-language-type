#pragma once

#include <stdint.h>

#ifdef VBLANK_BENCH

void vblank_bench_init(void) __banked;
void vblank_bench_print_right4(uint8_t v) __banked;

#endif

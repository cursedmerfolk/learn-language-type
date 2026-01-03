#pragma once

#include <stdint.h>

// Flat macrotile-id map decoder.
//
// Enable by building with `-DTILEMAP_MACRO` (e.g. `make MACRO=1`).
//
// Data is generated into build/assets/tilemap_macro_data.c/.h.

#ifdef TILEMAP_MACRO

#include "tilemap_macro_data.h"

typedef struct TilemapMacroCursor {

    // Derived coordinates for 3x3 macro-tiles.
    // - mx/my are macro-tile coordinates (x/3, y/3)
    // - ox/oy are offsets within the 3x3 macro-tile (x%3, y%3)
    uint8_t mx;
    uint8_t my;
    uint8_t ox;
    uint8_t oy;

    // Cell index within the current 3x3 macrotile (0..8), row-major.
    // cell = oy*3 + ox
    uint8_t cell;

    // Pointer into TILEMAP_MACRO_ID_MAP[] for the current (mx,my) macrotile.
    // Maintained incrementally while streaming to avoid expensive 16-bit indexed ROM reads
    // on each macrotile boundary.
    const uint8_t* macro_id_ptr;

    // Base index into the MACROTILES_* arrays for the current macrotile.
    // macro_base = macro_id * TILEMAP_MACRO_MACROTILE_CELLS
    uint16_t macro_base;
} TilemapMacroCursor;

void tilemap_macro_init(TilemapMacroCursor* c);

uint16_t tilemap_macro_seek_xy(TilemapMacroCursor* c, uint8_t x, uint8_t y);

uint16_t tilemap_macro_next_right(TilemapMacroCursor* c);

uint16_t tilemap_macro_next_down(TilemapMacroCursor* c);

#if defined(TILEMAP_MACRO_INSTRUMENT)
// Instrumentation API (primarily for host-side tests).
void tilemap_macro_instr_reset(void);
uint8_t tilemap_macro_instr_func_count(void);
uint32_t tilemap_macro_instr_call_count(uint8_t func_id);
uint64_t tilemap_macro_instr_total_ns(uint8_t func_id);
uint64_t tilemap_macro_instr_excl_ns(uint8_t func_id);

#ifndef __SDCC
const char* tilemap_macro_instr_func_name(uint8_t func_id);
#endif

#endif // TILEMAP_MACRO_INSTRUMENT

#endif // TILEMAP_MACRO

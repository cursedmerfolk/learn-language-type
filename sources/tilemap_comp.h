#pragma once

#ifndef TILEMAP_QUAD

#include <stdint.h>

// Data (dimensions, bank id, RLE arrays, packed tree arrays)
#include "tilemap_comp_data.h"

// Stateful decoder for sequential access without re-walking the tree.
typedef struct TilemapCompCursor {
    uint16_t tile_index;
    uint8_t x;
    uint8_t y;

    // Current macro-group in macro-tile space (row-major).
    uint16_t group_index;

    uint16_t run;
    uint16_t run_start_group_index;
    uint8_t group_offset;
    uint8_t group_in_run;
    uint8_t run_len;
} TilemapCompCursor;

// IMPORTANT: Callers must ensure the correct ROM bank is active (SWITCH_ROM(TILEMAP_COMP_BANK))
// before calling these functions, since they read TILEMAP_RLE_* data from banked ROM.
void tilemap_comp_cursor_seek(TilemapCompCursor* c, uint16_t tile_index);

// Read current tile value and advance by one tile.
uint8_t tilemap_comp_cursor_next(TilemapCompCursor* c);

#endif // not defined TILEMAP_QUAD

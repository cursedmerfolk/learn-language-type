#pragma once

#ifndef TILEMAP_QUAD

#include <stdint.h>

#include "tilemap_comp_data.h"

typedef struct TilemapCompCursor {
    uint16_t tile_index;
    uint8_t x;
    uint8_t y;

    uint16_t group_index;

    uint16_t run;
    uint16_t run_start_group_index;
    uint8_t group_offset;
    uint8_t group_in_run;
    uint8_t run_len;
} TilemapCompCursor;

void tilemap_comp_cursor_seek(TilemapCompCursor* c, uint16_t tile_index);

uint8_t tilemap_comp_cursor_next(TilemapCompCursor* c);

#endif

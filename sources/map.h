#pragma once

#include "game_types.h"

#if defined(__SDCC)
#include <gb/cgb.h>

#include "tileset_comp.h"

#include "tilemap_macro_data.h"
#include "tilemap_macro.h"
typedef TilemapMacroCursor TilemapCursor;
#define TILEMAP_MAP_BANK TILEMAP_MACRO_DATA_BANK
#define tilemap_cursor_init(c) tilemap_macro_init((c))
#define tilemap_stream_seek_xy(c, x, y) tilemap_macro_seek_xy((c), (x), (y))
#define tilemap_stream_next_right(c) tilemap_macro_next_right((c))
#define tilemap_stream_next_down(c) tilemap_macro_next_down((c))

#include "palette.h"

#endif

typedef struct Map {

    INT16 scroll_x;
    INT16 scroll_y;
    UINT16 tile_x;
    UINT16 tile_y;
    INT8 tile_offset_x;
    INT8 tile_offset_y;
    UINT8 vram_x_left;
    UINT8 vram_y_top;
} Map;

#define SCREEN_TILES_W 20
#define SCREEN_TILES_H 18
#define HORIZONTAL_TILE_LOOKAHEAD 1
#define VERTICAL_TILE_LOOKAHEAD   1
#define VRAM_WIDTH_MINUS_1  31
#define VRAM_HEIGHT_MINUS_1 31
#define COL_HEIGHT (SCREEN_TILES_H + VERTICAL_TILE_LOOKAHEAD)
#define ROW_WIDTH  (SCREEN_TILES_W + HORIZONTAL_TILE_LOOKAHEAD)

typedef enum MapBlockType {
    MAP_BLOCKTYPE_AIR = 0x00,

    MAP_BLOCKTYPE_SLOPE = 0x10,
    MAP_BLOCKTYPE_SOLID = 0x80,
} MapBlockType;

BOOLEAN map_is_solid_at(UINT16 map_tile_x, UINT16 map_tile_y);

void map_init(Map* map);

void map_set_scroll_immediate(Map* map, INT16 scroll_x, INT16 scroll_y);

void map_set_scroll(Map* map, INT16 scroll_x, INT16 scroll_y);

void map_apply_scroll(const Map* map);

void map_draw_full_screen(Map* map);

#ifndef __SDCC

void map_test_set_block_type_at(const Map* map, UINT16 map_tile_x, UINT16 map_tile_y, UINT8 block_type);
#endif

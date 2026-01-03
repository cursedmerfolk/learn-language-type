#pragma once

#include "game_types.h"

#if defined(__SDCC)
#include <gb/cgb.h>

#include "tileset_comp.h"     // FUTURE: remove if unused

#include "tilemap_macro_data.h" // TILEMAP_* macros + TILEMAP_MACRO_DATA_BANK
#include "tilemap_macro.h"
typedef TilemapMacroCursor TilemapCursor;
#define TILEMAP_MAP_BANK TILEMAP_MACRO_DATA_BANK
#define tilemap_cursor_init(c) tilemap_macro_init((c))
#define tilemap_stream_seek_xy(c, x, y) tilemap_macro_seek_xy((c), (x), (y))
#define tilemap_stream_next_right(c) tilemap_macro_next_right((c))
#define tilemap_stream_next_down(c) tilemap_macro_next_down((c))


#include "palette.h"     // tileset_palette

#endif // __SDCC


// Map state - tracks the background scroll position and tile streaming
typedef struct Map {
    // FUTURE: use one type (signed/unsigned) here for everything -> there are a lot of casts right now.
    INT16 scroll_x;      // Background scroll X position from top-left of the map
    INT16 scroll_y;      // Background scroll Y position from top-left of the map
    UINT16 tile_x;       // Current top-left screen tile X in map
    UINT16 tile_y;       // Current top-left screen tile Y in map
    INT8 tile_offset_x; // Pixel offset within current tile (used to determine when to stream a new tile, if offset >= 8)
    INT8 tile_offset_y; // Pixel offset within current tile (used to determine when to stream a new tile, if offset >= 8)
    UINT8 vram_x_left;    // Position of top-left of the screen in the gameboy's 32x32 VRAM window 
    UINT8 vram_y_top;    // Position of top-left of the screen in the gameboy's 32x32 VRAM window
} Map;

#define SCREEN_TILES_W 20
#define SCREEN_TILES_H 18
#define HORIZONTAL_TILE_LOOKAHEAD 1
#define VERTICAL_TILE_LOOKAHEAD   1
#define VRAM_WIDTH_MINUS_1  31
#define VRAM_HEIGHT_MINUS_1 31
#define COL_HEIGHT (SCREEN_TILES_H + VERTICAL_TILE_LOOKAHEAD)
#define ROW_WIDTH  (SCREEN_TILES_W + HORIZONTAL_TILE_LOOKAHEAD)

// -----------------------------------------------------------------------------
// Collision
// -----------------------------------------------------------------------------
// Collision type is derived on-demand from the map data:
//   - seek to (x,y) in the macro tilemap
//   - decode dictionary index
//   - read tile id from MACROTILES_IDS[index]
//   - look up collision type in TILEID_TO_TYPE[tile_id]

typedef enum MapBlockType {
    MAP_BLOCKTYPE_AIR = 0x00,
    // NOTE: TILEMAP encoding stores the type nibble in bits 15..12, so the
    // corresponding high byte value is (nibble << 4). For example:
    //   slope nibble 0x1 -> 0x10
    //   solid nibble 0x8 -> 0x80
    MAP_BLOCKTYPE_SLOPE = 0x10,
    MAP_BLOCKTYPE_SOLID = 0x80,
} MapBlockType;

// Query collision for a map tile coordinate (8x8 tile units).
BOOLEAN map_is_solid_at(UINT16 map_tile_x, UINT16 map_tile_y);

// FUTURE: remove if unused
// UINT8 map_get_block_type_at_pixel(const Map* map, INT16 world_x_px, INT16 world_y_px);
// BOOLEAN map_is_solid_at_pixel(const Map* map, INT16 world_x_px, INT16 world_y_px);

// Initialize map
void map_init(Map* map);

// Set scroll immediately (no streaming). Intended for initialization when jumping
// directly to a far-away scroll position before the first draw.
void map_set_scroll_immediate(Map* map, INT16 scroll_x, INT16 scroll_y);

// Set map scroll position (called by camera)
// This handles tile streaming when edges are crossed (GBDK builds).
void map_set_scroll(Map* map, INT16 scroll_x, INT16 scroll_y);

// Apply the map scroll to the background hardware (GBDK builds).
void map_apply_scroll(const Map* map);

// Draw the full initial screen (GBDK builds).
void map_draw_full_screen(Map* map);

#ifndef __SDCC
// Host-side test helper: set a collision type at a resident tile coordinate.
// Only intended for unit tests; does not stream tiles.
void map_test_set_block_type_at(const Map* map, UINT16 map_tile_x, UINT16 map_tile_y, UINT8 block_type);
#endif

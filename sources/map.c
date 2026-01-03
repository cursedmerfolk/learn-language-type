#include "map.h"

#include <string.h>

#if defined(__SDCC)

#include <gb/gbdecompress.h>

UINT8 col_tiles[COL_HEIGHT];
UINT8 row_tiles[ROW_WIDTH];
UINT8 col_attrs[COL_HEIGHT];
UINT8 row_attrs[ROW_WIDTH];
#endif

#ifndef __SDCC

#define HOST_COLLISION_W 256u
#define HOST_COLLISION_H 256u
static UINT8 g_host_block_types[HOST_COLLISION_W * HOST_COLLISION_H];

static UINT8 host_get_block_type(UINT16 map_tile_x, UINT16 map_tile_y) {
    if (map_tile_x >= HOST_COLLISION_W || map_tile_y >= HOST_COLLISION_H) {
        return MAP_BLOCKTYPE_AIR;
    }
    return g_host_block_types[(UINT16)(map_tile_y * HOST_COLLISION_W + map_tile_x)];
}

static void host_set_block_type(UINT16 map_tile_x, UINT16 map_tile_y, UINT8 block_type) {
    if (map_tile_x >= HOST_COLLISION_W || map_tile_y >= HOST_COLLISION_H) {
        return;
    }
    g_host_block_types[(UINT16)(map_tile_y * HOST_COLLISION_W + map_tile_x)] = block_type;
}

BOOLEAN map_is_solid_at(UINT16 map_tile_x, UINT16 map_tile_y) {
    return host_get_block_type(map_tile_x, map_tile_y) == MAP_BLOCKTYPE_SOLID;
}

void map_test_set_block_type_at(const Map* map, UINT16 map_tile_x, UINT16 map_tile_y, UINT8 block_type) {
    (void)map;
    host_set_block_type(map_tile_x, map_tile_y, block_type);
}

void map_draw_full_screen(Map* map) {
    (void)map;
}

#else

static TilemapCursor g_tile_cursor_query;

static UINT8 map_get_block_type_at_tile(UINT16 map_tile_x, UINT16 map_tile_y) {

#ifdef __SDCC
    UINT8 old_bank = _current_bank;
    SWITCH_ROM(TILEMAP_MAP_BANK);
#endif
    uint16_t dict_idx = tilemap_stream_seek_xy(&g_tile_cursor_query, (uint8_t)map_tile_x, (uint8_t)map_tile_y);
    uint8_t tile_id = MACROTILES_IDS[dict_idx];
    uint8_t block_type = TILEID_TO_TYPE[tile_id];
#ifdef __SDCC
    SWITCH_ROM(old_bank);
#endif
    return block_type;
}

BOOLEAN map_is_solid_at(UINT16 map_tile_x, UINT16 map_tile_y) {
    return map_get_block_type_at_tile(map_tile_x, map_tile_y) == MAP_BLOCKTYPE_SOLID;
}

static TilemapCursor g_tile_cursor_row;
static TilemapCursor g_tile_cursor_col;

void update_column(Map* map, UINT8 rel_x, UINT16 map_tile_y_start) {
    UINT8 vram_x = (map->vram_x_left + rel_x) & (VRAM_WIDTH_MINUS_1);
    UINT8 vram_y_start = map->vram_y_top;

    UINT8 yy;

    UINT8 old_bank = _current_bank;

    SWITCH_ROM(TILEMAP_MAP_BANK);
    uint16_t idx = tilemap_stream_seek_xy(&g_tile_cursor_col, (uint8_t)map->tile_x + rel_x, (uint8_t)map_tile_y_start);

    col_tiles[0] = MACROTILES_IDS[idx];
    col_attrs[0] = MACROTILES_ATTRS[idx];

    {
        TilemapCursor start_cursor;
        memcpy(&start_cursor, &g_tile_cursor_col, sizeof(start_cursor));
        for (yy = 1; yy < COL_HEIGHT; ++yy) {
            idx = tilemap_macro_next_down(&g_tile_cursor_col);
            col_tiles[yy] = MACROTILES_IDS[idx];
            col_attrs[yy] = MACROTILES_ATTRS[idx];
        }
        memcpy(&g_tile_cursor_col, &start_cursor, sizeof(start_cursor));
    }
    SWITCH_ROM(old_bank);

    VBK_REG = VBK_TILES;
    set_bkg_tiles(vram_x, vram_y_start, 1, COL_HEIGHT, col_tiles);

    VBK_REG = VBK_ATTRIBUTES;
    set_bkg_tiles(vram_x, vram_y_start, 1, COL_HEIGHT, col_attrs);
}

void update_row(
    Map* map,
    UINT8 rel_y,
    UINT16 map_tile_x_start
) {

    UINT8 vram_y = (map->vram_y_top + rel_y) & (VRAM_HEIGHT_MINUS_1);
    UINT8 vram_x_start = map->vram_x_left;

    UINT8 xx;

    UINT8 old_bank = _current_bank;

    SWITCH_ROM(TILEMAP_MAP_BANK);
    uint16_t idx = tilemap_stream_seek_xy(&g_tile_cursor_row, (uint8_t)map_tile_x_start, (uint8_t)map->tile_y + rel_y);

    row_tiles[0] = MACROTILES_IDS[idx];
    row_attrs[0] = MACROTILES_ATTRS[idx];

    {
        TilemapCursor start_cursor;
        memcpy(&start_cursor, &g_tile_cursor_row, sizeof(start_cursor));
        for (xx = 1; xx < ROW_WIDTH; ++xx) {
            idx = tilemap_macro_next_right(&g_tile_cursor_row);
            row_tiles[xx] = MACROTILES_IDS[idx];
            row_attrs[xx] = MACROTILES_ATTRS[idx];
        }
        memcpy(&g_tile_cursor_row, &start_cursor, sizeof(start_cursor));
    }
    SWITCH_ROM(old_bank);

    VBK_REG = VBK_TILES;
    set_bkg_tiles(vram_x_start, vram_y, ROW_WIDTH, 1, row_tiles);

    VBK_REG = VBK_ATTRIBUTES;
    set_bkg_tiles(vram_x_start, vram_y, ROW_WIDTH, 1, row_attrs);
}

void map_draw_full_screen(Map* map) {
    for (UINT8 y = 0; y < COL_HEIGHT; ++y) {
        update_row(map, y, map->tile_x);
    }
}
#endif

void map_init(Map* map) {
    map->scroll_x = 0;
    map->scroll_y = 0;
    map->tile_x = 0;
    map->tile_y = 0;
    map->tile_offset_x = 0;
    map->tile_offset_y = 0;
    map->vram_x_left = 0;
    map->vram_y_top = 0;

#if defined(__SDCC)

    tilemap_cursor_init(&g_tile_cursor_row);
    tilemap_cursor_init(&g_tile_cursor_col);
    tilemap_cursor_init(&g_tile_cursor_query);

    gb_decompress_bkg_data(0, tileset_comp);
    VBK_REG = VBK_TILES;

    set_bkg_palette(0, 8, tileset_palette);
#else
    memset(g_host_block_types, 0, sizeof(g_host_block_types));
#endif
}

void map_set_scroll_immediate(Map* map, INT16 new_scroll_x, INT16 new_scroll_y) {

    map->scroll_x = new_scroll_x;
    map->scroll_y = new_scroll_y;

    map->tile_x = (UINT16)((UINT16)new_scroll_x >> 3);
    map->tile_y = (UINT16)((UINT16)new_scroll_y >> 3);
    map->tile_offset_x = (INT8)((UINT16)new_scroll_x & 0b0111);
    map->tile_offset_y = (INT8)((UINT16)new_scroll_y & 0b0111);

    map->vram_x_left = (UINT8)(map->tile_x & VRAM_WIDTH_MINUS_1);
    map->vram_y_top = (UINT8)(map->tile_y & VRAM_HEIGHT_MINUS_1);
}

void map_set_scroll(Map* map, INT16 new_scroll_x, INT16 new_scroll_y) {

    INT16 delta_x = new_scroll_x - map->scroll_x;
    INT16 delta_y = new_scroll_y - map->scroll_y;

    map->scroll_x = new_scroll_x;
    map->scroll_y = new_scroll_y;

    if (delta_x > 0) {

        map->tile_offset_x += delta_x;
        while (map->tile_offset_x >= 8) {
            map->tile_offset_x -= 8;
            map->tile_x++;
            map->vram_x_left = (map->vram_x_left + 1) & (VRAM_WIDTH_MINUS_1);

#if defined(__SDCC)
            update_column(map, SCREEN_TILES_W, map->tile_y);
#endif
        }
    } else if (delta_x < 0) {

        map->tile_offset_x += delta_x;
        while (map->tile_offset_x < 0) {
            map->tile_offset_x += 8;
            map->tile_x--;
            map->vram_x_left = (map->vram_x_left - 1) & (VRAM_WIDTH_MINUS_1);

#if defined(__SDCC)
            update_column(map, 0, map->tile_y);
#endif
        }
    }

    if (delta_y > 0) {

        map->tile_offset_y += delta_y;
        while (map->tile_offset_y >= 8) {
            map->tile_offset_y -= 8;
            map->tile_y++;
            map->vram_y_top = (map->vram_y_top + 1) & (VRAM_HEIGHT_MINUS_1);

#if defined(__SDCC)
            update_row(map, SCREEN_TILES_H, map->tile_x);
#endif
        }
    } else if (delta_y < 0) {

        map->tile_offset_y += delta_y;
        while (map->tile_offset_y < 0) {
            map->tile_offset_y += 8;
            map->tile_y--;
            map->vram_y_top = (map->vram_y_top - 1) & (VRAM_HEIGHT_MINUS_1);

#if defined(__SDCC)
            update_row(map, 0, map->tile_x);
#endif
        }
    }
}

void map_apply_scroll(const Map* map) {
    (void)map;
#if defined(__SDCC)
    move_bkg((UINT8)map->scroll_x, (UINT8)map->scroll_y);
#endif
}

#pragma once

#include <stdint.h>

#ifdef TILEMAP_QUAD

#include "tilemap_quad_data.h"

typedef struct TilemapQuadCursor {

    uint8_t mx;
    uint8_t my;
    uint8_t ox;
    uint8_t oy;

    uint16_t quad_path;

    const uint8_t* leaf_pat;
    uint8_t leaf_shift;
    uint8_t leaf_inv_mask;
    uint8_t depth;

    uint8_t leaf_x;
    uint8_t leaf_y;

    uint16_t node_idx_stack[TILEMAP_QUAD_STACK_DEPTH];
} TilemapQuadCursor;

void tilemap_quad_init(TilemapQuadCursor* c);

void tilemap_quad_seek_xy(TilemapQuadCursor* c, uint8_t x, uint8_t y);

void tilemap_quad_next_right(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr);

void tilemap_quad_next_down(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr);

#if defined(TILEMAP_QUAD_INSTRUMENT)

void tilemap_quad_instr_reset(void);
uint8_t tilemap_quad_instr_func_count(void);
uint32_t tilemap_quad_instr_call_count(uint8_t func_id);
uint64_t tilemap_quad_instr_total_ns(uint8_t func_id);
uint64_t tilemap_quad_instr_excl_ns(uint8_t func_id);

uint32_t tilemap_quad_instr_traverse_calls(void);
uint32_t tilemap_quad_instr_traverse_total_iters(void);
uint8_t tilemap_quad_instr_traverse_max_iters(void);
uint32_t tilemap_quad_instr_traverse_hist(uint8_t iters);

#ifndef __SDCC
const char* tilemap_quad_instr_func_name(uint8_t func_id);
#endif

#endif

#endif

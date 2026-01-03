#pragma once

#include <stdint.h>

// Quadtree/k^2-tree based tilemap decoder.
//
// This module is intentionally build-time optional to avoid ROM bloat while experimenting.
// Enable by building with `-DTILEMAP_QUAD` (e.g. `make QUAD=1`).
//
// Data is generated into build/assets/tilemap_quad_data.c/.h.

#ifdef TILEMAP_QUAD

// Generated data header provides TILEMAP_WIDTH/HEIGHT as well as
// TILEMAP_QUAD_SUBTREE_LOG2 and TILEMAP_QUAD_STACK_DEPTH.
#include "tilemap_quad_data.h"

// Cursor that supports fast successive seeks by reusing the previous path.
//
// Coordinate system:
// - tile_index is the linear 8x8 tile index (y * TILEMAP_WIDTH + x)
// - x/y are in 8x8 tile units
//
// Internally we traverse a quadtree over a padded power-of-two square.
// Leaves can cover large regions; when the next access stays within the current leaf
// region, lookup becomes O(1).

typedef struct TilemapQuadCursor {
    // Derived coordinates for 3x3 macro-tiles.
    // - mx/my are macro-tile coordinates (x/3, y/3)
    // - ox/oy are offsets within the 3x3 macro-tile (x%3, y%3)
    uint8_t mx;
    uint8_t my;
    uint8_t ox;
    uint8_t oy;

    // Packed per-level quadrant path bits for the current (mx,my) within its macro-subtree.
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    // quad_path stores quad(level0) at bits 1:0 and quad(level1) at bits 3:2.
    uint16_t quad_path;

    // Cached leaf region that contains (mx,my)
    const uint8_t* leaf_pat; // points to interleaved (tile,attr) bytes for a 3x3 macro
    uint8_t leaf_shift;      // leaf region size in macro-tiles is (1 << leaf_shift)
    uint8_t leaf_inv_mask;   // precomputed: ~((1<<leaf_shift)-1) (or 0 when leaf_shift>=8)
    uint8_t depth;      // current traversal depth (0=root), for finger seeking

    // Coordinate used to compute the current cached leaf region.
    // This is needed because x/y are advanced by next(), so mx/my may no longer
    // correspond to leaf_pat/leaf_shift.
    uint8_t leaf_x;
    uint8_t leaf_y;

    // Node indices along the current path for subtree-levels [0..K'].
    // Indexed by subtree-level.
    uint16_t node_idx_stack[TILEMAP_QUAD_STACK_DEPTH];
} TilemapQuadCursor;

// Initialize a quad cursor.
void tilemap_quad_init(TilemapQuadCursor* c);

// Seek using explicit x/y and a precomputed linear tile index (y*TILEMAP_WIDTH + x).
// This also ensures the internal leaf cache is ready for immediate reads.
void tilemap_quad_seek_xy(TilemapQuadCursor* c, uint8_t x, uint8_t y);

// Return the (tile,attr) at the cursor and advance one tile to the right (linear order).
// When advancing past the end of the map, returns (0,0).
// This API always uses the cached path and will refresh the cache only when crossing
// 3x3 macro-tile boundaries.
void tilemap_quad_next_right(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr);

// Return the (tile,attr) at the cursor and advance one tile down (same x, y+1).
// When stepping past the last row, cursor enters end-of-map state.
// This combines the common column-streaming sequence:
//   read current -> step_down -> if crossed macro boundary, refresh cache
void tilemap_quad_next_down(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr);

#if defined(TILEMAP_QUAD_INSTRUMENT)
// Instrumentation API (primarily for host-side tests). Counts function enter/exit events.
void tilemap_quad_instr_reset(void);
uint8_t tilemap_quad_instr_func_count(void);
uint32_t tilemap_quad_instr_call_count(uint8_t func_id);
uint64_t tilemap_quad_instr_total_ns(uint8_t func_id);
uint64_t tilemap_quad_instr_excl_ns(uint8_t func_id);

// ensure_cached() traversal stats (host-focused):
// - traverse_calls: number of times we entered the traversal loop (i.e., non-cache-hit seeks)
// - total_iters: sum of loop iterations across those calls
// - max_iters: maximum loop iterations seen
// - hist(iters): count of calls with that many iterations; iters>=8 is bucketed into 8
uint32_t tilemap_quad_instr_traverse_calls(void);
uint32_t tilemap_quad_instr_traverse_total_iters(void);
uint8_t tilemap_quad_instr_traverse_max_iters(void);
uint32_t tilemap_quad_instr_traverse_hist(uint8_t iters);

// Human-readable names are only provided for host builds.
#ifndef __SDCC
const char* tilemap_quad_instr_func_name(uint8_t func_id);
#endif

#endif // TILEMAP_QUAD_INSTRUMENT

#endif // TILEMAP_QUAD

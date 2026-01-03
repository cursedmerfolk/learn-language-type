#include "tilemap_quad.h"

#ifdef TILEMAP_QUAD

#include "tilemap_quad_data.h"

#if defined(TILEMAP_QUAD_INSTRUMENT)

typedef enum TilemapQuadInstrFuncId {
    TQI_msb_index_u8 = 0,
    TQI_ensure_cached,
    // Sub-section timing within ensure_cached()
    TQI_csm_cache_check,
    TQI_csm_finger_seek,
    TQI_csm_start_node,
    TQI_csm_traverse,
    TQI_csm_leaf_setup,
    TQI_csm_leafk_setup,
    TQI_tilemap_quad_init,
    TQI_tilemap_quad_seek_xy_idx,
    TQI_tilemap_quad_next_right,
    TQI_tilemap_quad_next_down,
    TQI_FUNC_COUNT
} TilemapQuadInstrFuncId;

#if defined(__SDCC)

void tilemap_quad_instr_reset(void) { }
uint8_t tilemap_quad_instr_func_count(void) { return (uint8_t)TQI_FUNC_COUNT; }
uint32_t tilemap_quad_instr_call_count(uint8_t func_id) { (void)func_id; return 0u; }
uint64_t tilemap_quad_instr_total_ns(uint8_t func_id) { (void)func_id; return 0ull; }
uint64_t tilemap_quad_instr_excl_ns(uint8_t func_id) { (void)func_id; return 0ull; }
uint32_t tilemap_quad_instr_traverse_calls(void) { return 0u; }
uint32_t tilemap_quad_instr_traverse_total_iters(void) { return 0u; }
uint8_t tilemap_quad_instr_traverse_max_iters(void) { return 0u; }
uint32_t tilemap_quad_instr_traverse_hist(uint8_t iters) { (void)iters; return 0u; }

#define TQI_BEGIN(_id) do { (void)(_id); } while (0)
#define TQI_END(_id) do { (void)(_id); } while (0)

#else

#include <sys/time.h>

static uint32_t g_tqi_calls[TQI_FUNC_COUNT];
static uint64_t g_tqi_total_ns[TQI_FUNC_COUNT];
static uint64_t g_tqi_excl_ns[TQI_FUNC_COUNT];

// Traversal loop iteration stats for ensure_cached():
// counts how many iterations the `while (level < K)` loop runs per non-cache-hit seek.
static uint32_t g_tqi_traverse_calls;
static uint32_t g_tqi_traverse_total_iters;
static uint8_t g_tqi_traverse_max_iters;
// Histogram indexed by iteration count (0..8), last bucket is "8+".
static uint32_t g_tqi_traverse_hist[9];

// Simple instrumentation call stack so nested calls work correctly.
// Keep this small; we only ever nest a few levels.
#ifndef TILEMAP_QUAD_INSTR_STACK_MAX
#define TILEMAP_QUAD_INSTR_STACK_MAX 32
#endif

static uint8_t g_tqi_stack_ids[TILEMAP_QUAD_INSTR_STACK_MAX];
static uint64_t g_tqi_stack_start_ns[TILEMAP_QUAD_INSTR_STACK_MAX];
static uint64_t g_tqi_stack_child_ns[TILEMAP_QUAD_INSTR_STACK_MAX];
static uint8_t g_tqi_sp;

static uint64_t tqi_now_ns(void) {
    struct timeval tv;
    gettimeofday(&tv, 0);
    return ((uint64_t)tv.tv_sec * 1000000000ull) + ((uint64_t)tv.tv_usec * 1000ull);
}

static void tilemap_quad_instr_enter(uint8_t func_id) {
    if (g_tqi_sp >= (uint8_t)TILEMAP_QUAD_INSTR_STACK_MAX) return;
    g_tqi_stack_ids[g_tqi_sp] = func_id;
    g_tqi_stack_start_ns[g_tqi_sp] = tqi_now_ns();
    g_tqi_stack_child_ns[g_tqi_sp] = 0ull;
    g_tqi_sp++;
}

static void tilemap_quad_instr_exit(uint8_t func_id) {
    if (g_tqi_sp == 0u) return;
    g_tqi_sp--;
    // If mismatched, still attribute time to the popped id.
    uint8_t popped_id = g_tqi_stack_ids[g_tqi_sp];
    uint64_t start_ns = g_tqi_stack_start_ns[g_tqi_sp];
    uint64_t child_ns = g_tqi_stack_child_ns[g_tqi_sp];
    uint64_t end_ns = tqi_now_ns();
    uint64_t delta = (end_ns >= start_ns) ? (end_ns - start_ns) : 0ull;
    uint64_t excl = (delta >= child_ns) ? (delta - child_ns) : 0ull;

    if (popped_id < (uint8_t)TQI_FUNC_COUNT) {
        g_tqi_calls[popped_id]++;
        g_tqi_total_ns[popped_id] += delta;
        g_tqi_excl_ns[popped_id] += excl;
    }

    // Attribute the *inclusive* child time to the parent, for exclusive-time accounting.
    if (g_tqi_sp != 0u) {
        uint8_t parent_sp = (uint8_t)(g_tqi_sp - 1u);
        g_tqi_stack_child_ns[parent_sp] += delta;
    }

    (void)func_id;
}

void tilemap_quad_instr_reset(void) {
    for (uint8_t i = 0; i < (uint8_t)TQI_FUNC_COUNT; i++) {
        g_tqi_calls[i] = 0u;
        g_tqi_total_ns[i] = 0ull;
        g_tqi_excl_ns[i] = 0ull;
    }
    g_tqi_traverse_calls = 0u;
    g_tqi_traverse_total_iters = 0u;
    g_tqi_traverse_max_iters = 0u;
    for (uint8_t i = 0; i < (uint8_t)9; i++) g_tqi_traverse_hist[i] = 0u;
    g_tqi_sp = 0u;
}

uint8_t tilemap_quad_instr_func_count(void) {
    return (uint8_t)TQI_FUNC_COUNT;
}

uint32_t tilemap_quad_instr_call_count(uint8_t func_id) {
    return (func_id < (uint8_t)TQI_FUNC_COUNT) ? g_tqi_calls[func_id] : 0u;
}

uint64_t tilemap_quad_instr_total_ns(uint8_t func_id) {
    return (func_id < (uint8_t)TQI_FUNC_COUNT) ? g_tqi_total_ns[func_id] : 0ull;
}

uint64_t tilemap_quad_instr_excl_ns(uint8_t func_id) {
    return (func_id < (uint8_t)TQI_FUNC_COUNT) ? g_tqi_excl_ns[func_id] : 0ull;
}

uint32_t tilemap_quad_instr_traverse_calls(void) {
    return g_tqi_traverse_calls;
}

uint32_t tilemap_quad_instr_traverse_total_iters(void) {
    return g_tqi_traverse_total_iters;
}

uint8_t tilemap_quad_instr_traverse_max_iters(void) {
    return g_tqi_traverse_max_iters;
}

uint32_t tilemap_quad_instr_traverse_hist(uint8_t iters) {
    if (iters >= 8u) iters = 8u;
    return g_tqi_traverse_hist[iters];
}

static void tqi_record_traverse_iters(uint8_t iters) {
    g_tqi_traverse_calls++;
    g_tqi_traverse_total_iters += (uint32_t)iters;
    if (iters > g_tqi_traverse_max_iters) g_tqi_traverse_max_iters = iters;
    if (iters >= 8u) iters = 8u;
    g_tqi_traverse_hist[iters]++;
}

const char* tilemap_quad_instr_func_name(uint8_t func_id) {
    static const char* const names[TQI_FUNC_COUNT] = {
        "msb_index_u8",
        "ensure_cached",
        "csm_cache_check",
        "csm_finger_seek",
        "csm_start_node",
        "csm_traverse",
        "csm_leaf_setup",
        "csm_leafk_setup",
        "tilemap_quad_init",
        "tilemap_quad_seek_xy_idx",
        "tilemap_quad_next_right",
        "tilemap_quad_next_down",
    };
    return (func_id < (uint8_t)TQI_FUNC_COUNT) ? names[func_id] : "<invalid>";
}

#define TQI_BEGIN(_id) tilemap_quad_instr_enter((uint8_t)(_id))
#define TQI_END(_id) tilemap_quad_instr_exit((uint8_t)(_id))
#define TQI_RECORD_TRAVERSE_ITERS(_iters) tqi_record_traverse_iters((uint8_t)(_iters))

#endif // !__SDCC

#else

#define TQI_BEGIN(_id) do { } while (0)
#define TQI_END(_id) do { } while (0)
#define TQI_RECORD_TRAVERSE_ITERS(_iters) do { (void)(_iters); } while (0)

#endif // TILEMAP_QUAD_INSTRUMENT

static uint16_t macrotile_bytes_offset(uint8_t macrotile_id) {
    // Assumption: TILEMAP_QUAD_MACROTILE_BYTES == 18
    // 18 = 16 + 2
    uint16_t id = (uint16_t)macrotile_id;
    return (uint16_t)((id << 4) + (id << 1));
}

static uint8_t macro_cell_index(uint8_t ox, uint8_t oy) {
#if TILEMAP_QUAD_GROUP_SIDE == 3
    // oy is always 0..2 when GROUP_SIDE==3.
    static const uint8_t oy_base[3] = { 0u, 3u, 6u };
    return (uint8_t)(oy_base[oy] + ox);
#else
    return (uint8_t)(oy * TILEMAP_QUAD_GROUP_SIDE + ox);
#endif
}

static uint8_t macro_entry_offset(uint8_t cell) {
    // Assumption: TILEMAP_QUAD_ENTRY_STRIDE == 2 (tile,attr)
    return (uint8_t)(cell << 1);
}

static uint16_t cursor_root_idx_from_mx_my(uint8_t mx, uint8_t my) {
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    uint8_t bx = (uint8_t)(mx >> 2);
    uint8_t by = (uint8_t)(my >> 2);
#if TILEMAP_QUAD_SUBTREE_W_LOG2 != 255
    return (uint16_t)(((uint16_t)by << (uint16_t)TILEMAP_QUAD_SUBTREE_W_LOG2) | (uint16_t)bx);
#else
    return (uint16_t)(((uint16_t)by * (uint16_t)TILEMAP_QUAD_SUBTREE_W) + (uint16_t)bx);
#endif
}

static void cursor_update_quad_path_from_mx_my(TilemapQuadCursor* c) {
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    // K=2 is common in this project. Use a tiny LUT indexed by (my_local<<2)|mx_local.
    // quad_path stores quad(level0) at bits 1:0 and quad(level1) at bits 3:2.
    static const uint8_t g_quad_path_u2_lut[16] = {
        0u, 4u, 1u, 5u,
        8u, 12u, 9u, 13u,
        2u, 6u, 3u, 7u,
        10u, 14u, 11u, 15u
    };
    uint8_t mx_local = (uint8_t)(c->mx & 3u);
    uint8_t my_local = (uint8_t)(c->my & 3u);
    c->quad_path = (uint16_t)g_quad_path_u2_lut[(uint8_t)((my_local << 2) | mx_local)];
}

static void cursor_update_seek_state(TilemapQuadCursor* c) {
    // Full recompute after arbitrary seek.
    c->node_idx_stack[0] = cursor_root_idx_from_mx_my(c->mx, c->my);
    cursor_update_quad_path_from_mx_my(c);
}

static void cursor_update_macro_step_right(TilemapQuadCursor* c) {
    // Called after c->mx++.
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    // If we wrapped within-subtree x bits back to 0, we entered a new subtree column.
    if (((uint8_t)(c->mx & 3u)) == 0u) {
        c->node_idx_stack[0] = (uint16_t)(c->node_idx_stack[0] + 1u);
    }

    cursor_update_quad_path_from_mx_my(c);
}

static void cursor_update_macro_step_down(TilemapQuadCursor* c) {
    // Called after c->my++.
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    // If we wrapped within-subtree y bits back to 0, we entered a new subtree row.
    if (((uint8_t)(c->my & 3u)) == 0u) {
#if TILEMAP_QUAD_SUBTREE_W_LOG2 != 255
    c->node_idx_stack[0] = (uint16_t)(c->node_idx_stack[0] + (uint16_t)(1u << TILEMAP_QUAD_SUBTREE_W_LOG2));
#else
    c->node_idx_stack[0] = (uint16_t)(c->node_idx_stack[0] + (uint16_t)TILEMAP_QUAD_SUBTREE_W);
#endif
    }

    cursor_update_quad_path_from_mx_my(c);
}

static void cursor_read_pair_cached(const TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr) {
    if (out_tile) *out_tile = 0;
    if (out_attr) *out_attr = 0;

    // Trust caller: cursor must be in-range and leaf cache must be valid.

    uint8_t cell = macro_cell_index(c->ox, c->oy);
    uint8_t off = macro_entry_offset(cell);
    if (out_tile) *out_tile = c->leaf_pat[(uint8_t)(off + TILEMAP_QUAD_ENTRY_TILE_OFF)];
    if (out_attr) *out_attr = c->leaf_pat[(uint8_t)(off + TILEMAP_QUAD_ENTRY_ATTR_OFF)];
}

static void ensure_cached(TilemapQuadCursor* c) {
    TQI_BEGIN(TQI_ensure_cached);

    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    uint8_t mx = c->mx;
    uint8_t my = c->my;

    TQI_BEGIN(TQI_csm_finger_seek);
    // Finger seek within the current macro-subtree:
    // - subtree depth is K (K decisions)
    // - if macro coords moved to a different subtree (top bits changed), restart from level 0.
    uint8_t level = 0u;
    if (c->leaf_shift != 0xFFu) {
        uint8_t dx = (uint8_t)(mx ^ c->leaf_x);
        uint8_t dy = (uint8_t)(my ^ c->leaf_y);
        uint8_t diff = (uint8_t)(dx | dy);
        // If the macro moved to a different subtree (top bits changed),
        // we can't reuse a deeper node path.
        if ((uint8_t)(diff >> 2) != 0u) {
            level = 0u;
        } else {
            // K=2 => diff_low in {0,1,2,3}. msb_index(diff_low) is 0 for {1}, 1 for {2,3}.
            uint8_t diff_low = (uint8_t)(diff & 3u);
            if (diff_low == 0u) {
                level = c->depth;
            } else if ((diff_low & 2u) != 0u) {
                level = 0u;
            } else {
                level = 1u;
            }
            if (level > c->depth) level = c->depth;
        }
    }
    TQI_END(TQI_csm_finger_seek);

    TQI_BEGIN(TQI_csm_start_node);
    uint16_t idx;
    uint8_t rel;
    if (level == 0u) {
        // Subtree root node index is cached at node_idx_stack[0].
        idx = c->node_idx_stack[0];
        rel = 0u;
    } else {
        rel = level;
        idx = c->node_idx_stack[rel];
    }
    TQI_END(TQI_csm_start_node);

    TQI_BEGIN(TQI_csm_traverse);
    // Assumption: TILEMAP_QUAD_SUBTREE_LOG2 == 2.
    // Unrolled traversal avoids variable shifts that SDCC tends to emit as slow loops.
#if defined(TILEMAP_QUAD_INSTRUMENT)
    uint8_t traverse_iters = 0;
#endif

    // Level 0
    if (level == 0u) {
#if defined(TILEMAP_QUAD_INSTRUMENT)
        traverse_iters++;
#endif
        {
            const uint16_t* descs = TILEMAP_QUAD_NODE_DESC_PTRS[0];
            uint16_t d = descs[idx];
            if ((uint16_t)(d & 0x8000u) != 0u) {
                TQI_BEGIN(TQI_csm_leaf_setup);
                {
                    uint16_t leaf_index = (uint16_t)(d & 0x7FFFu);
                    const uint8_t* base = TILEMAP_QUAD_LEAF_TILES_PTRS[0];
                    uint8_t macrotile_id = base[leaf_index];
                    c->leaf_pat = &MACROTILES[macrotile_bytes_offset(macrotile_id)];
                }
                c->leaf_shift = 2u;
                c->leaf_inv_mask = 0xFCu;
                c->depth = 0u;
                c->leaf_x = mx;
                c->leaf_y = my;
                TQI_END(TQI_csm_leaf_setup);
#if defined(TILEMAP_QUAD_INSTRUMENT)
                TQI_RECORD_TRAVERSE_ITERS(traverse_iters);
#endif
                TQI_END(TQI_csm_traverse);
                goto out;
            }

            // Internal: advance to level 1
            idx = (uint16_t)(d + (uint16_t)(c->quad_path & 3u));
            c->node_idx_stack[1] = idx;
            level = 1u;
            rel = 1u;
        }
    }

    // Level 1
    if (level == 1u) {
#if defined(TILEMAP_QUAD_INSTRUMENT)
        traverse_iters++;
#endif
        {
            const uint16_t* descs = TILEMAP_QUAD_NODE_DESC_PTRS[1];
            uint16_t d = descs[idx];
            if ((uint16_t)(d & 0x8000u) != 0u) {
                TQI_BEGIN(TQI_csm_leaf_setup);
                {
                    uint16_t leaf_index = (uint16_t)(d & 0x7FFFu);
                    const uint8_t* base = TILEMAP_QUAD_LEAF_TILES_PTRS[1];
                    uint8_t macrotile_id = base[leaf_index];
                    c->leaf_pat = &MACROTILES[macrotile_bytes_offset(macrotile_id)];
                }
                c->leaf_shift = 1u;
                c->leaf_inv_mask = 0xFEu;
                c->depth = 1u;
                c->leaf_x = mx;
                c->leaf_y = my;
                TQI_END(TQI_csm_leaf_setup);
#if defined(TILEMAP_QUAD_INSTRUMENT)
                TQI_RECORD_TRAVERSE_ITERS(traverse_iters);
#endif
                TQI_END(TQI_csm_traverse);
                goto out;
            }

            // Internal: advance to level 2 (K)
            idx = (uint16_t)(d + (uint16_t)((c->quad_path >> 2) & 3u));
            c->node_idx_stack[2] = idx;
            level = 2u;
            rel = 2u;
        }
    }

#if defined(TILEMAP_QUAD_INSTRUMENT)
    TQI_RECORD_TRAVERSE_ITERS(traverse_iters);
#endif
    TQI_END(TQI_csm_traverse);

    // Level == 2: implied full leaf level (explicit macro-tile patterns).
    TQI_BEGIN(TQI_csm_leafk_setup);
    {
        const uint8_t* base = TILEMAP_QUAD_LEAF_TILES_PTRS[2];
        uint8_t macrotile_id = base[idx];
        c->leaf_pat = &MACROTILES[macrotile_bytes_offset(macrotile_id)];
    }
    c->leaf_shift = 0u;
    c->leaf_inv_mask = 0xFFu;
    c->depth = 2u;
    c->leaf_x = mx;
    c->leaf_y = my;
    TQI_END(TQI_csm_leafk_setup);

out:
    TQI_END(TQI_ensure_cached);
}

void tilemap_quad_init(TilemapQuadCursor* c) {
    TQI_BEGIN(TQI_tilemap_quad_init);
    c->mx = 0;
    c->my = 0;
    c->ox = 0;
    c->oy = 0;
    c->quad_path = 0u;
    c->node_idx_stack[0] = 0u;
    c->leaf_pat = 0;
    c->leaf_shift = 0xFFu; // invalid
    c->leaf_inv_mask = 0u;
    c->depth = 0;
    c->leaf_x = 0;
    c->leaf_y = 0;
    // node_idx_stack entries are initialized lazily by ensure_cached().
    TQI_END(TQI_tilemap_quad_init);
}

void tilemap_quad_seek_xy(TilemapQuadCursor* c, uint8_t x, uint8_t y) {
    TQI_BEGIN(TQI_tilemap_quad_seek_xy_idx);

    c->mx = TILEMAP_QUAD_X_TO_MX[x];
    c->my = TILEMAP_QUAD_Y_TO_MY[y];
    c->ox = TILEMAP_QUAD_X_TO_OX[x];
    c->oy = TILEMAP_QUAD_Y_TO_OY[y];

    cursor_update_seek_state(c);

    // Fast-path cache hit for arbitrary seek.
    TQI_BEGIN(TQI_csm_cache_check);
    if (c->leaf_shift != 0xFFu) {
        uint8_t inv = c->leaf_inv_mask;
        uint8_t dx = (uint8_t)(c->mx ^ c->leaf_x);
        uint8_t dy = (uint8_t)(c->my ^ c->leaf_y);
        if (((uint8_t)((dx | dy) & inv)) == 0u) {
            c->leaf_x = c->mx;
            c->leaf_y = c->my;
            TQI_END(TQI_csm_cache_check);
            TQI_END(TQI_tilemap_quad_seek_xy_idx);
            return;
        }
    }
    TQI_END(TQI_csm_cache_check);

    ensure_cached(c);

    TQI_END(TQI_tilemap_quad_seek_xy_idx);
}

void tilemap_quad_next_right(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr) {
    TQI_BEGIN(TQI_tilemap_quad_next_right);

    cursor_read_pair_cached(c, out_tile, out_attr);

    // Advance one linear tile.
    c->ox++;

    if (c->ox >= (uint8_t)TILEMAP_QUAD_GROUP_SIDE) {
        c->ox = 0;
        c->mx++;

        cursor_update_macro_step_right(c);

        // Fast-path cache hit for +X macro step.
        TQI_BEGIN(TQI_csm_cache_check);
        if (c->leaf_shift != 0xFFu) {
            uint8_t inv = c->leaf_inv_mask;
            uint8_t dx = (uint8_t)(c->mx ^ c->leaf_x);
            if (((uint8_t)(dx & inv)) == 0u) {
                c->leaf_x = c->mx;
                TQI_END(TQI_csm_cache_check);
                TQI_END(TQI_tilemap_quad_next_right);
                return;
            }
        }
        TQI_END(TQI_csm_cache_check);

        ensure_cached(c);
    }

    TQI_END(TQI_tilemap_quad_next_right);
}

void tilemap_quad_next_down(TilemapQuadCursor* c, uint8_t* out_tile, uint8_t* out_attr) {
    TQI_BEGIN(TQI_tilemap_quad_next_down);

    cursor_read_pair_cached(c, out_tile, out_attr);

    c->oy++;
    if (c->oy >= (uint8_t)TILEMAP_QUAD_GROUP_SIDE) {
        c->oy = 0;
        c->my++;

        cursor_update_macro_step_down(c);

        // Fast-path cache hit for +Y macro step.
        TQI_BEGIN(TQI_csm_cache_check);
        if (c->leaf_shift != 0xFFu) {
            uint8_t inv = c->leaf_inv_mask;
            uint8_t dy = (uint8_t)(c->my ^ c->leaf_y);
            if (((uint8_t)(dy & inv)) == 0u) {
                c->leaf_y = c->my;
                TQI_END(TQI_csm_cache_check);
                TQI_END(TQI_tilemap_quad_next_down);
                return;
            }
        }
        TQI_END(TQI_csm_cache_check);

        ensure_cached(c);
    }

    TQI_END(TQI_tilemap_quad_next_down);
}

#endif // TILEMAP_QUAD

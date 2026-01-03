#include "tilemap_comp.h"

// Optional lightweight profiling.
// Enable by adding `-DTILEMAP_COMP_PROFILE` to the build.
#ifdef TILEMAP_COMP_PROFILE
#include <gb/gb.h>

// Coarse timing: accumulated DIV_REG ticks (16384 Hz). This is not cycle-accurate, but
// it is stable and easy to inspect over many calls.
volatile uint32_t tilemap_prof_cursor_seek_div_total;
volatile uint32_t tilemap_prof_run_len_div_total;
volatile uint32_t tilemap_prof_tree_get_div_total;
volatile uint32_t tilemap_prof_read_bits_div_total;

static uint8_t prof_div_delta(uint8_t start, uint8_t end) {
    return (uint8_t)(end - start); // wrap-safe for uint8_t
}
#endif

static uint16_t tilemap_comp_tree_get(uint8_t level, uint16_t pos) {
#ifdef TILEMAP_COMP_PROFILE
    uint8_t prof_start = DIV_REG;
#endif
    uint8_t width = TILEMAP_RLE_TREE_LEVEL_BITS[level];
    uint16_t bitpos = (uint16_t)(pos * width);
    const uint8_t* data = TILEMAP_RLE_TREE_LEVEL_PTRS[level];

    // data has 2 extra padding bytes, so 3-byte reads are safe.
    uint16_t byte_index = (uint16_t)(bitpos >> 3);
    uint8_t shift = (uint8_t)(bitpos & 7u);
    uint32_t acc = (uint32_t)data[byte_index]
        | ((uint32_t)data[(uint16_t)(byte_index + 1u)] << 8)
        | ((uint32_t)data[(uint16_t)(byte_index + 2u)] << 16);
    acc >>= shift;
    uint16_t mask = (width >= 16u) ? 0xFFFFu : (uint16_t)((1u << width) - 1u);
    uint16_t out = (uint16_t)(acc & mask);
#ifdef TILEMAP_COMP_PROFILE
    tilemap_prof_tree_get_div_total = (uint32_t)(tilemap_prof_tree_get_div_total + prof_div_delta(prof_start, DIV_REG));
#endif
    return out;
}

static uint8_t tilemap_comp_run_len(uint16_t run) {
#ifdef TILEMAP_COMP_PROFILE
    uint8_t prof_start = DIV_REG;
#endif
    // Run lengths are packed: two 4-bit values per byte, stored as (len-1).
    uint8_t packed_len = TILEMAP_RLE_LENS[(uint16_t)(run >> 1)];
    uint8_t len_minus_1 = (run & 1u) ? (uint8_t)(packed_len >> 4) : (uint8_t)(packed_len & 0x0Fu);
    uint8_t out = (uint8_t)(len_minus_1 + 1u);
#ifdef TILEMAP_COMP_PROFILE
    tilemap_prof_run_len_div_total = (uint32_t)(tilemap_prof_run_len_div_total + prof_div_delta(prof_start, DIV_REG));
#endif
    return out;
}

static void tilemap_comp_set_run_for_group(TilemapCompCursor* c, uint16_t group_index) {
    // Step 4: find which RLE run contains group_index.
    uint16_t idx = group_index;
    uint16_t pos = 0;
    for (uint8_t level = 0; level < (uint8_t)(TILEMAP_RLE_TREE_DEPTH - 1u); level++) {
        uint16_t left_sum = tilemap_comp_tree_get((uint8_t)(level + 1u), (uint16_t)(pos * 2u));
        if (idx < left_sum) {
            pos = (uint16_t)(pos * 2u);
        } else {
            idx = (uint16_t)(idx - left_sum);
            pos = (uint16_t)(pos * 2u + 1u);
        }
    }

    // Final step: decide between the two leaf runs under this parent using the 4-bit run length table.
    uint16_t left_run = (uint16_t)(pos * 2u);
    uint8_t left_len = (left_run < TILEMAP_RLE_RUN_COUNT) ? tilemap_comp_run_len(left_run) : 0u;
    if (idx < (uint16_t)left_len) {
        c->run = left_run;
    } else {
        idx = (uint16_t)(idx - (uint16_t)left_len);
        c->run = (uint16_t)(left_run + 1u);
    }

    c->run_len = (c->run < TILEMAP_RLE_RUN_COUNT) ? tilemap_comp_run_len(c->run) : 0u;
    c->group_in_run = (uint8_t)idx;
    c->run_start_group_index = (uint16_t)(group_index - (uint16_t)c->group_in_run);
}

void tilemap_comp_cursor_seek(TilemapCompCursor* c, uint16_t tile_index) {
#ifdef TILEMAP_COMP_PROFILE
    uint8_t prof_start = DIV_REG;
#endif
    // Step 1: store the requested tile index (0..TILEMAP_TILE_COUNT-1).
    // The cursor always tracks a *tile* position, even though the RLE is built over
    // TILEMAP_GROUP_SIZE-byte logical groups (a TILEMAP_GROUP_SIDE x TILEMAP_GROUP_SIDE macro-tile).
    c->tile_index = tile_index;

    // Step 2: handle out-of-range requests by putting the cursor into an invalid/sentinel state.
    // Callers can treat reads past the end as returning 0.
    if (tile_index >= TILEMAP_TILE_COUNT) {
        c->run = TILEMAP_RLE_RUN_COUNT;
        c->run_start_group_index = 0;
        c->group_offset = 0;
        c->group_in_run = 0;
        c->run_len = 0;
        c->x = 0;
        c->y = 0;
        c->group_index = 0;
#ifdef TILEMAP_COMP_PROFILE
        tilemap_prof_cursor_seek_div_total = (uint32_t)(tilemap_prof_cursor_seek_div_total + prof_div_delta(prof_start, DIV_REG));
#endif
        return;
    }

    // Step 3: compute x/y tile coordinates.
    c->x = (uint8_t)(tile_index % TILEMAP_WIDTH);
    c->y = (uint8_t)(tile_index / TILEMAP_WIDTH);

    // Step 4: convert to (group_index, group_offset) for a TILEMAP_GROUP_SIDE x TILEMAP_GROUP_SIDE macro-tile.
    // group_index is in macro-tile space, row-major.
    uint16_t group_index = (uint16_t)(((uint16_t)(c->y / TILEMAP_GROUP_SIDE) * (uint16_t)TILEMAP_GROUP_WIDTH) + (uint16_t)(c->x / TILEMAP_GROUP_SIDE));
    c->group_index = group_index;
    c->group_offset = (uint8_t)(((uint8_t)(c->y % TILEMAP_GROUP_SIDE) * (uint8_t)TILEMAP_GROUP_SIDE) + (uint8_t)(c->x % TILEMAP_GROUP_SIDE));

    // Step 5: locate and cache the run containing group_index.
    tilemap_comp_set_run_for_group(c, group_index);

#ifdef TILEMAP_COMP_PROFILE
    tilemap_prof_cursor_seek_div_total = (uint32_t)(tilemap_prof_cursor_seek_div_total + prof_div_delta(prof_start, DIV_REG));
#endif
}

uint8_t tilemap_comp_cursor_next(TilemapCompCursor* c) {
    // Step 1-2: clamp out-of-range reads to 0.
    // The cursor can be placed past the end via tilemap_comp_cursor_seek().
    // If the run is out of range, the cursor is in an invalid/sentinel state.
    if (c->tile_index >= TILEMAP_TILE_COUNT) return 0;
    if (c->run >= TILEMAP_RLE_RUN_COUNT) return 0;

    // Step 3: fetch the current tile byte.
    // Each run stores exactly one TILEMAP_GROUP_SIZE-byte macro-tile pattern; the run repeats that
    // pattern run_len times across macro-tile space.
    uint16_t base = (uint16_t)(c->run * TILEMAP_GROUP_SIZE);
    uint8_t out = TILEMAP_RLE_GROUPS[(uint16_t)(base + c->group_offset)];

    // Step 4: advance one tile (row-major in TILEMAP space).
    c->tile_index++;
    c->x++;
    if (c->x >= (uint8_t)TILEMAP_WIDTH) {
        c->x = 0;
        c->y++;
    }

    // Step 5: if we're past the end, mark sentinel state for future reads.
    if (c->tile_index >= TILEMAP_TILE_COUNT) {
        c->run = TILEMAP_RLE_RUN_COUNT;
        c->run_len = 0;
        c->group_in_run = 0;
        c->group_offset = 0;
        return out;
    }

    // Step 6: update (group_index, group_offset) for the new x/y.
    {
        uint16_t new_group_index = (uint16_t)(((uint16_t)(c->y / TILEMAP_GROUP_SIDE) * (uint16_t)TILEMAP_GROUP_WIDTH) + (uint16_t)(c->x / TILEMAP_GROUP_SIDE));
        uint8_t new_group_offset = (uint8_t)(((uint8_t)(c->y % TILEMAP_GROUP_SIDE) * (uint8_t)TILEMAP_GROUP_SIDE) + (uint8_t)(c->x % TILEMAP_GROUP_SIDE));

        if (new_group_index != c->group_index) {
            // Fast path: if the new group falls within the currently cached run range, no tree walk is needed.
            uint16_t run_start = c->run_start_group_index;
            uint16_t run_end = (uint16_t)(run_start + (uint16_t)c->run_len);
            if ((new_group_index >= run_start) && (new_group_index < run_end) && (c->run < TILEMAP_RLE_RUN_COUNT)) {
                c->group_in_run = (uint8_t)(new_group_index - run_start);
            } else {
                tilemap_comp_set_run_for_group(c, new_group_index);
            }
            c->group_index = new_group_index;
        }

        c->group_offset = new_group_offset;
    }

    return out;
}

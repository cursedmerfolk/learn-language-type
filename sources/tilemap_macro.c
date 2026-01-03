#include "tilemap_macro.h"

#ifdef TILEMAP_MACRO

#if defined(TILEMAP_MACRO_INSTRUMENT) && !defined(__SDCC)
#include <sys/time.h>

static uint64_t now_ns(void) {

    struct timeval tv;
    gettimeofday(&tv, 0);
    return ((uint64_t)tv.tv_sec * 1000000000ull) + ((uint64_t)tv.tv_usec * 1000ull);
}

enum {
    INSTR_MACROTILE_PTR_FOR = 0,
    INSTR_INIT = 1,
    INSTR_SEEK_XY = 2,
    INSTR_NEXT_RIGHT = 3,
    INSTR_NEXT_DOWN = 4,
    INSTR_COUNT = 5,
};

static uint32_t g_calls[INSTR_COUNT];
static uint64_t g_total_ns[INSTR_COUNT];
static uint64_t g_excl_ns[INSTR_COUNT];

static uint8_t g_stack[16];
static uint64_t g_stack_t0[16];
static uint8_t g_sp;

static void instr_enter(uint8_t id) {
    uint64_t t = now_ns();
    if (g_sp < (uint8_t)(sizeof(g_stack) / sizeof(g_stack[0]))) {
        g_stack[g_sp] = id;
        g_stack_t0[g_sp] = t;
        g_sp++;
    }
}

static void instr_exit(uint8_t id) {
    uint64_t t1 = now_ns();
    if (g_sp == 0u) {
        return;
    }
    g_sp--;

    uint64_t t0 = g_stack_t0[g_sp];
    uint64_t dt = (t1 >= t0) ? (t1 - t0) : 0ull;

    g_calls[id]++;
    g_total_ns[id] += dt;
    g_excl_ns[id] += dt;

    if (g_sp > 0u) {
        uint8_t parent = g_stack[g_sp - 1u];
        g_excl_ns[parent] -= dt;
    }
}

void tilemap_macro_instr_reset(void) {
    for (uint8_t i = 0; i < (uint8_t)INSTR_COUNT; ++i) {
        g_calls[i] = 0u;
        g_total_ns[i] = 0ull;
        g_excl_ns[i] = 0ull;
    }
    g_sp = 0u;
}

uint8_t tilemap_macro_instr_func_count(void) {
    return (uint8_t)INSTR_COUNT;
}

uint32_t tilemap_macro_instr_call_count(uint8_t func_id) {
    if (func_id >= (uint8_t)INSTR_COUNT) return 0u;
    return g_calls[func_id];
}

uint64_t tilemap_macro_instr_total_ns(uint8_t func_id) {
    if (func_id >= (uint8_t)INSTR_COUNT) return 0ull;
    return g_total_ns[func_id];
}

uint64_t tilemap_macro_instr_excl_ns(uint8_t func_id) {
    if (func_id >= (uint8_t)INSTR_COUNT) return 0ull;
    return g_excl_ns[func_id];
}

const char* tilemap_macro_instr_func_name(uint8_t func_id) {
    switch (func_id) {
        case INSTR_MACROTILE_PTR_FOR:
            return "macrotile_ptr_for";
        case INSTR_INIT:
            return "tilemap_macro_init";
        case INSTR_SEEK_XY:
            return "tilemap_macro_seek_xy";
        case INSTR_NEXT_RIGHT:
            return "tilemap_macro_next_right";
        case INSTR_NEXT_DOWN:
            return "tilemap_macro_next_down";
        default:
            return "?";
    }
}

#define INSTR_ENTER(id) instr_enter((id))
#define INSTR_EXIT(id) instr_exit((id))

#elif defined(TILEMAP_MACRO_INSTRUMENT)

void tilemap_macro_instr_reset(void) {}
uint8_t tilemap_macro_instr_func_count(void) { return 0u; }
uint32_t tilemap_macro_instr_call_count(uint8_t func_id) {
    (void)func_id;
    return 0u;
}
uint64_t tilemap_macro_instr_total_ns(uint8_t func_id) {
    (void)func_id;
    return 0ull;
}
uint64_t tilemap_macro_instr_excl_ns(uint8_t func_id) {
    (void)func_id;
    return 0ull;
}

#define INSTR_ENTER(id) ((void)0)
#define INSTR_EXIT(id) ((void)0)

#else

#define INSTR_ENTER(id) ((void)0)
#define INSTR_EXIT(id) ((void)0)

#endif

static uint16_t macrotile_base_for_id(uint8_t id) {
    INSTR_ENTER(0);

    uint16_t base = (uint16_t)(((uint16_t)id << 3) + (uint16_t)id);
    INSTR_EXIT(0);
    return base;
}

void tilemap_macro_init(TilemapMacroCursor* c) {
    INSTR_ENTER(1);
    c->mx = 0;
    c->my = 0;
    c->ox = 0;
    c->oy = 0;
    c->cell = 0;
    c->macro_id_ptr = TILEMAP_MACRO_ID_MAP;
    c->macro_base = 0;
    INSTR_EXIT(1);
}

uint16_t tilemap_macro_seek_xy(TilemapMacroCursor* c, uint8_t x, uint8_t y) {
    INSTR_ENTER(2);

    c->mx = TILEMAP_MACRO_X_TO_MX[x];
    c->ox = TILEMAP_MACRO_X_TO_OX[x];
    c->my = TILEMAP_MACRO_Y_TO_MY[y];
    c->oy = TILEMAP_MACRO_Y_TO_OY[y];

    c->cell = (uint8_t)((uint8_t)((c->oy << 1) + c->oy) + c->ox);

    {
        uint16_t macro_idx = (uint16_t)TILEMAP_MACRO_MY_TO_ROW_OFF[c->my] + (uint16_t)c->mx;
        c->macro_id_ptr = &TILEMAP_MACRO_ID_MAP[macro_idx];
        c->macro_base = macrotile_base_for_id(*c->macro_id_ptr);
    }

    uint16_t idx = (uint16_t)(c->macro_base + (uint16_t)c->cell);

    INSTR_EXIT(2);

    return idx;
}

uint16_t tilemap_macro_next_right(TilemapMacroCursor* c) {
    INSTR_ENTER(3);

    if ((uint8_t)(c->ox + 1u) >= TILEMAP_MACRO_GROUP_SIDE) {
        c->ox = 0;
        c->mx++;

        c->cell = (uint8_t)((c->oy << 1) + c->oy);
        c->macro_id_ptr++;
        c->macro_base = macrotile_base_for_id(*c->macro_id_ptr);
    } else {
        c->ox++;
        c->cell++;
    }

    uint16_t idx = (uint16_t)(c->macro_base + (uint16_t)c->cell);

    INSTR_EXIT(3);
    return idx;
}

uint16_t tilemap_macro_next_down(TilemapMacroCursor* c) {
    INSTR_ENTER(4);

    if ((uint8_t)(c->oy + 1u) >= TILEMAP_MACRO_GROUP_SIDE) {
        c->oy = 0;
        c->my++;

        c->cell = c->ox;
        c->macro_id_ptr = &c->macro_id_ptr[TILEMAP_MACRO_WIDTH];
        c->macro_base = macrotile_base_for_id(*c->macro_id_ptr);
    } else {
        c->oy++;
        c->cell = (uint8_t)(c->cell + 3u);
    }

    uint16_t idx = (uint16_t)(c->macro_base + (uint16_t)c->cell);

    INSTR_EXIT(4);
    return idx;
}

#endif

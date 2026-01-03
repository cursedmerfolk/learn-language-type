#pragma once

#include <stdint.h>

#ifdef TILEMAP_MACRO

#include "tilemap_macro_data.h"

typedef struct TilemapMacroCursor {

    uint8_t mx;
    uint8_t my;
    uint8_t ox;
    uint8_t oy;

    uint8_t cell;

    const uint8_t* macro_id_ptr;

    uint16_t macro_base;
} TilemapMacroCursor;

void tilemap_macro_init(TilemapMacroCursor* c);

uint16_t tilemap_macro_seek_xy(TilemapMacroCursor* c, uint8_t x, uint8_t y);

uint16_t tilemap_macro_next_right(TilemapMacroCursor* c);

uint16_t tilemap_macro_next_down(TilemapMacroCursor* c);

#if defined(TILEMAP_MACRO_INSTRUMENT)

void tilemap_macro_instr_reset(void);
uint8_t tilemap_macro_instr_func_count(void);
uint32_t tilemap_macro_instr_call_count(uint8_t func_id);
uint64_t tilemap_macro_instr_total_ns(uint8_t func_id);
uint64_t tilemap_macro_instr_excl_ns(uint8_t func_id);

#ifndef __SDCC
const char* tilemap_macro_instr_func_name(uint8_t func_id);
#endif

#endif

#endif

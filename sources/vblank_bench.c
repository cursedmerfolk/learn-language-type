#ifdef VBLANK_BENCH

#pragma bank 2

#include <stdint.h>

#include <gb/gb.h>
#include <gb/cgb.h>

// Minimal digit tiles (2bpp), color index 3 on 0 background.
// Each row is stored as (low, high) bitplanes; using the same mask for both
// yields color 3 for set pixels.
static const uint8_t BENCH_DIGITS_2BPP[11u * 16u] = {
    // '0'
    0x3C,0x3C, 0x66,0x66, 0x6E,0x6E, 0x76,0x76, 0x66,0x66, 0x66,0x66, 0x3C,0x3C, 0x00,0x00,
    // '1'
    0x18,0x18, 0x38,0x38, 0x18,0x18, 0x18,0x18, 0x18,0x18, 0x18,0x18, 0x3C,0x3C, 0x00,0x00,
    // '2'
    0x3C,0x3C, 0x66,0x66, 0x06,0x06, 0x0C,0x0C, 0x18,0x18, 0x30,0x30, 0x7E,0x7E, 0x00,0x00,
    // '3'
    0x3C,0x3C, 0x66,0x66, 0x06,0x06, 0x1C,0x1C, 0x06,0x06, 0x66,0x66, 0x3C,0x3C, 0x00,0x00,
    // '4'
    0x0C,0x0C, 0x1C,0x1C, 0x3C,0x3C, 0x6C,0x6C, 0x7E,0x7E, 0x0C,0x0C, 0x0C,0x0C, 0x00,0x00,
    // '5'
    0x7E,0x7E, 0x60,0x60, 0x7C,0x7C, 0x06,0x06, 0x06,0x06, 0x66,0x66, 0x3C,0x3C, 0x00,0x00,
    // '6'
    0x1C,0x1C, 0x30,0x30, 0x60,0x60, 0x7C,0x7C, 0x66,0x66, 0x66,0x66, 0x3C,0x3C, 0x00,0x00,
    // '7'
    0x7E,0x7E, 0x66,0x66, 0x06,0x06, 0x0C,0x0C, 0x18,0x18, 0x18,0x18, 0x18,0x18, 0x00,0x00,
    // '8'
    0x3C,0x3C, 0x66,0x66, 0x66,0x66, 0x3C,0x3C, 0x66,0x66, 0x66,0x66, 0x3C,0x3C, 0x00,0x00,
    // '9'
    0x3C,0x3C, 0x66,0x66, 0x66,0x66, 0x3E,0x3E, 0x06,0x06, 0x0C,0x0C, 0x38,0x38, 0x00,0x00,
    // ' ' (blank)
    0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00,
};

// Use sprites so the overlay doesn't blank the entire screen (the window layer
// always covers from WY to the bottom).
// Player animation tiles are loaded starting at IDLE_TILE_BASE (currently 256,
// which wraps to 0 for the hardware's 8-bit tile indices), and occupy 80 tiles.
// So choose a base after that in the 0..255 range.
#define BENCH_SPR_TILE_BASE 80u
#define BENCH_SPR_TILE_BLANK (BENCH_SPR_TILE_BASE + 10u)

// Player renderer uses sprites 0..39 (see hide_sprites_range(..., 40)), so use
// 40+ for the HUD.
#define BENCH_SPR_ID_THOUSANDS 36u
#define BENCH_SPR_ID_HUNDREDS  37u
#define BENCH_SPR_ID_TENS      38u
#define BENCH_SPR_ID_ONES      39u

void vblank_bench_init(void) __banked {
    uint8_t old_vbk = VBK_REG;
    VBK_REG = VBK_TILES;

    // Upload digit tiles into sprite VRAM.
    set_sprite_data(BENCH_SPR_TILE_BASE, 11u, BENCH_DIGITS_2BPP);

    // Place at top-right: four 8x8 sprites.
    // GBDK sprite coords are hardware coords: top-left is (8,16).
    set_sprite_tile(BENCH_SPR_ID_THOUSANDS, (uint8_t)BENCH_SPR_TILE_BLANK);
    set_sprite_tile(BENCH_SPR_ID_HUNDREDS, (uint8_t)BENCH_SPR_TILE_BLANK);
    set_sprite_tile(BENCH_SPR_ID_TENS, (uint8_t)BENCH_SPR_TILE_BLANK);
    set_sprite_tile(BENCH_SPR_ID_ONES, (uint8_t)BENCH_SPR_TILE_BLANK);

    move_sprite(BENCH_SPR_ID_THOUSANDS, 136u, 16u);
    move_sprite(BENCH_SPR_ID_HUNDREDS, 144u, 16u);
    move_sprite(BENCH_SPR_ID_TENS, 152u, 16u);
    move_sprite(BENCH_SPR_ID_ONES, 160u, 16u);
    VBK_REG = old_vbk;
}

void vblank_bench_print_right4(uint8_t v) __banked {
    uint8_t th = (uint8_t)(v / 1000u);
    uint8_t h = (uint8_t)((v / 100u) % 10u);
    uint8_t t = (uint8_t)((v / 10u) % 10u);
    uint8_t o = (uint8_t)(v % 10u);

    // Leading blanks.
    set_sprite_tile(
        BENCH_SPR_ID_THOUSANDS,
        (th != 0u) ? (uint8_t)(BENCH_SPR_TILE_BASE + th) : (uint8_t)BENCH_SPR_TILE_BLANK
    );
    set_sprite_tile(
        BENCH_SPR_ID_HUNDREDS,
        (th != 0u || h != 0u) ? (uint8_t)(BENCH_SPR_TILE_BASE + h) : (uint8_t)BENCH_SPR_TILE_BLANK
    );
    set_sprite_tile(
        BENCH_SPR_ID_TENS,
        (th != 0u || h != 0u || t != 0u) ? (uint8_t)(BENCH_SPR_TILE_BASE + t) : (uint8_t)BENCH_SPR_TILE_BLANK
    );
    set_sprite_tile(BENCH_SPR_ID_ONES, (uint8_t)(BENCH_SPR_TILE_BASE + o));
}

#endif

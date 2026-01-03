#include "example.h"

int clamp_int(int value, int min_value, int max_value) {
    if (value < min_value) return min_value;
    if (value > max_value) return max_value;
    return value;
}

size_t strlcpy_safe(char *dst, const char *src, size_t dst_size) {
    size_t i = 0;

    if (dst_size == 0) return 0;

    while (src[i] != '\0' && i + 1 < dst_size) {
        dst[i] = src[i];
        i++;
    }

    dst[i] = '\0';

    while (src[i] != '\0') {
        i++;
    }

    return i;
}

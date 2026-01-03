#ifndef EXAMPLE_H
#define EXAMPLE_H

#include <stddef.h>

int clamp_int(int value, int min_value, int max_value);
size_t strlcpy_safe(char *dst, const char *src, size_t dst_size);

#endif

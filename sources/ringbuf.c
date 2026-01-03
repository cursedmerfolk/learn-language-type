#include <stddef.h>
#include <stdint.h>

struct ringbuf {
    uint8_t *data;
    size_t cap;
    size_t head;
    size_t tail;
};

static size_t rb_next(size_t idx, size_t cap) {
    return (idx + 1) % cap;
}

int rb_push(struct ringbuf *rb, uint8_t value) {
    size_t next = rb_next(rb->head, rb->cap);
    if (next == rb->tail) return 0; /* full */
    rb->data[rb->head] = value;
    rb->head = next;
    return 1;
}

int rb_pop(struct ringbuf *rb, uint8_t *out) {
    if (rb->head == rb->tail) return 0; /* empty */
    *out = rb->data[rb->tail];
    rb->tail = rb_next(rb->tail, rb->cap);
    return 1;
}

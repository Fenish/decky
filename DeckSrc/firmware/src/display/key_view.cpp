#include "display/key_view.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "keygrid.h"
#include "panel.h"

void KeyView::write_text(int cell, const uint16_t *source) {
    SlidingText *text = pages_.active->texts[cell];
    const SlidingText::Box box = text->box();
    text->frame(millis());
    const int image_w = KeyImage::width(), image_h = KeyImage::height();
    const keygrid::Rect rect = keygrid::cell(cell);
    uint16_t *frame = panel::framebuffer();
    static uint16_t line[panel::WIDTH];
    int composed = -1;
    for (int y = 0; y < rect.h; ++y) {
        const int sy = y * image_h / rect.h;
        if (sy < box.y || sy >= box.y + box.h) continue;
        if (sy != composed) {
            text->row(sy, source + sy * image_w, line);
            composed = sy;
        }
        uint16_t *target = frame + (rect.y + y) * panel::WIDTH + rect.x;
        if (rect.w == image_w) memcpy(target + box.x, line, box.w * sizeof(uint16_t));
        else
            for (int x = 0; x < rect.w; ++x) {
                const int sx = x * image_w / rect.w;
                if (sx >= box.x && sx < box.x + box.w) target[x] = line[sx - box.x];
            }
    }
}

void KeyView::write_key(int cell, bool pressed) {
    const keygrid::Rect rect = keygrid::cell(cell);
    const uint32_t start = micros();
    Page *active = pages_.active;
    if (active && active->complete) {
        // The protocol's uniform image size comes from cell 0. Actual openings
        // may differ by one pixel after rounding; nearest-neighbour mapping
        // covers them.
        const int image_w = KeyImage::width(), image_h = KeyImage::height();
        const bool alternate = (session_.current_state & (1 << cell)) && active->alternates[cell];
        // An animation draws its own picture, composed beforehand, and no outline.
        const bool turning = animations_.armed(cell, active->id, active->signature) && animations_.frame(cell);
        if (turning) pressed = false;
        const uint16_t *source = turning     ? animations_.frame(cell)
                                 : alternate ? active->alternates[cell]
                                             : active->shown_off(cell);
        uint16_t *frame = panel::framebuffer();
        // The divisions stay out of the pixel loop: the column map once per
        // key, the source line once per row. A key as wide as the image -
        // nearly all of them - copies each row with one memcpy. A division per
        // pixel took a key 3 ms; the whole page redraw, 83 ms.
        static uint16_t columns[panel::WIDTH];
        const bool same_width = rect.w == image_w;
        if (!same_width)
            for (int x = 0; x < rect.w; ++x) columns[x] = x * image_w / rect.w;
        for (int y = 0; y < rect.h; ++y) {
            const uint16_t *line = source + (y * image_h / rect.h) * image_w;
            uint16_t *target = frame + (rect.y + y) * panel::WIDTH + rect.x;
            if (same_width) memcpy(target, line, rect.w * sizeof(uint16_t));
            else
                for (int x = 0; x < rect.w; ++x) target[x] = line[columns[x]];
        }
        if (!turning && active->texts[cell]) write_text(cell, source);
        if (pressed && ((alternate ? active->alternate_lit : active->lit_mask) & (1 << cell)))
            panel::display.drawRoundRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 9, 0xFFFF);
    } else {
        // An unconfigured device is pitch black, with no numbered placeholders.
        panel::display.fillRect(rect.x, rect.y, rect.w, rect.h, 0x0000);
    }
    screen_.wrote(micros() - start);
}

void KeyView::draw_key(int cell, bool pressed) {
    screen_.wait(keygrid::cell(cell));
    write_key(cell, pressed);
}

// Each key goes out the moment its row is clear of the scanout, in whatever
// order that happens, rather than all fifteen waiting their turn in index
// order (61 ms a page). Some row is always clear, so the copies - about 2 ms a
// key, PSRAM to PSRAM beside the scanout - run nearly back to back. Past the
// deadline the rest are written regardless, so a redraw can never hang.
void KeyView::draw_page() {
    const uint32_t started = micros();
    uint32_t remaining = (1u << keygrid::COUNT) - 1;
    const uint32_t deadline = micros() + panel::frame_period_us() * 8;
    while (remaining) {
        const bool late = static_cast<int32_t>(deadline - micros()) <= 0;
        for (int cell = 0; cell < keygrid::COUNT; ++cell) {
            if (!(remaining & (1u << cell))) continue;
            if (!late && !screen_.clear(keygrid::cell(cell))) continue;
            write_key(cell, false);
            remaining &= ~(1u << cell);
        }
    }
    page_draw_us_ = micros() - started;
}

void KeyView::text_frames() {
    Page *active = pages_.active;
    if (!active || !active->complete || status_.shown() || session_.transitioning) return;
    const uint32_t now = millis();
    const int image_h = KeyImage::height();
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        SlidingText *text = active->texts[cell];
        if (!text || animations_.armed(cell, active->id, active->signature) || !text->due(now)) continue;
        const SlidingText::Box box = text->box();
        const keygrid::Rect key = keygrid::cell(cell);
        const keygrid::Rect rows{key.x, key.y + box.y * key.h / image_h, key.w,
                                 (box.h * key.h + image_h - 1) / image_h + 1};
        if (!screen_.clear(rows)) continue;
        const bool alternate = (session_.current_state & (1 << cell)) && active->alternates[cell];
        write_text(cell, alternate ? active->alternates[cell] : active->shown_off(cell));
    }
}

#include "keygrid.h"

#include <cmath>

namespace keygrid
{
int to_px_x(float mm)
{
    return static_cast<int>(lroundf(mm * (panel::WIDTH / panel::ACTIVE_W_MM)));
}

int to_px_y(float mm)
{
    return static_cast<int>(lroundf(mm * (panel::HEIGHT / panel::ACTIVE_H_MM)));
}

Rect cell(int row, int col)
{
    const float x0_mm = col * (CELL_W_MM + RIB_MM);
    const float y0_mm = row * (CELL_H_MM + RIB_MM);

    const int x0 = to_px_x(x0_mm);
    const int y0 = to_px_y(y0_mm);
    const int x1 = to_px_x(x0_mm + CELL_W_MM);
    const int y1 = to_px_y(y0_mm + CELL_H_MM);

    return Rect{x0, y0, x1 - x0, y1 - y0};
}

Rect cell(int index)
{
    return cell(index / COLS, index % COLS);
}

int hit(int x, int y)
{
    // Walked rather than computed from the pitch, because the cell edges are
    // rounded to whole pixels one cell at a time. Deriving the index by
    // dividing by the pitch would disagree with cell() by a pixel at some
    // boundaries, and then a key would light up while its neighbour was
    // touched. Fifteen comparisons cost nothing at touch rates.
    for(int index = 0; index < COUNT; ++index) {
        const Rect r = cell(index);
        if(x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
            return index;
        }
    }

    return -1;
}
}

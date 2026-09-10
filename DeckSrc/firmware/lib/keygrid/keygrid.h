/*---------------------------------------------------------------
 * Key layout.
 *
 * The single place that knows where the 15 keys are. Everything is expressed in
 * millimetres and converted to pixels here, because the enclosure is designed in
 * millimetres and the panel's pixels are not square - 5.2002 px/mm horizontally
 * against 5.6055 px/mm vertically. Anything that hard-codes pixel positions, or
 * uses one scale for both axes, will drift out of line with the printed part.
 *--------------------------------------------------------------*/

#pragma once

#include "panel.h"

namespace keygrid
{
// Layout from the Fusion design. These are exact against the panel's active
// area: 5 * 22.768 + 4 * 10 = 153.84 and 3 * 21.877 + 2 * 10 = 85.63. The
// openings therefore sit flush with the active-area corner and the ribs exist
// only between cells, never at the edge.
constexpr int   COLS = 5;
constexpr int   ROWS = 3;
constexpr int   COUNT = COLS * ROWS;
constexpr float CELL_W_MM = 22.768f;
constexpr float CELL_H_MM = 21.877f;
constexpr float RIB_MM = 10.0f;

/**
 * @brief A key opening in pixels.
 */
struct Rect
{
    int x;
    int y;
    int w;
    int h;
};

/**
 * @brief Convert a millimetre distance to a pixel column.
 * @param mm Distance from the left edge of the active area.
 * @return Nearest pixel column.
 */
int to_px_x(float mm);

/**
 * @brief Convert a millimetre distance to a pixel row.
 * @param mm Distance from the top edge of the active area.
 * @return Nearest pixel row.
 */
int to_px_y(float mm);

/**
 * @brief Pixel rectangle of one key opening.
 * @param row Row index, 0 at the top.
 * @param col Column index, 0 at the left.
 * @return The opening's rectangle, clipped to nothing - callers get exactly the
 *         area the printed rib leaves visible.
 */
Rect cell(int row, int col);

/**
 * @brief Pixel rectangle of one key opening by index.
 * @param index Key index, 0 to COUNT - 1, in reading order.
 * @return The opening's rectangle.
 */
Rect cell(int index);

/**
 * @brief Which key contains a point.
 * @param x Pixel column on the panel.
 * @param y Pixel row on the panel.
 * @return Key index, or -1 for a point in the gap between keys.
 * @note The ribs are dead. A touch that lands between two keys belongs to
 *       neither, which keeps the boundary unambiguous - snapping to the
 *       nearest key would make the edges of the grid guess at intent.
 */
int hit(int x, int y);
}

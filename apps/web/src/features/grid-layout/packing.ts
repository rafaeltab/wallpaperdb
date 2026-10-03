import type { LayoutItem } from './contract';

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Simple bin-packing layout using the "maxrects" approach.
 * This mimics Muuri's default "First Fit" algorithm.
 *
 * @param items - Array of items with getWidth() and getHeight() methods
 * @param gridWidth - Total width of the grid container
 * @param excludeRect - Optional rectangle to exclude (for expanded item)
 * @returns Array of [x, y] positions for each item
 */
export function binPackLayout(
  items: LayoutItem[],
  gridWidth: number,
  excludeRect?: { x: number; y: number; width: number; height: number } | null
): number[] {
  const slots: number[] = [];
  let bottom = excludeRect ? excludeRect.y + excludeRect.height : 0;

  // Track free rectangles - start with the entire grid (infinite height)
  let freeRects: FreeRect[] = [{ x: 0, y: 0, width: gridWidth, height: Infinity }];

  // If there's an excluded rect (expanded item), remove that space from free rects
  if (excludeRect) {
    freeRects = subtractRect(freeRects, excludeRect);
  }

  for (const item of items) {
    const itemWidth = item.width;
    const itemHeight = item.height;

    // Find the best position (First Fit - lowest Y, then lowest X)
    let bestRect: FreeRect | null = null;
    let bestY = Infinity;
    let bestX = Infinity;

    for (const rect of freeRects) {
      if (rect.width >= itemWidth && rect.height >= itemHeight) {
        // This rect can fit the item
        if (rect.y < bestY || (rect.y === bestY && rect.x < bestX)) {
          bestY = rect.y;
          bestX = rect.x;
          bestRect = rect;
        }
      }
    }

    if (bestRect) {
      // Place item at top-left of the best rect
      slots.push(bestRect.x, bestRect.y);
      bottom = Math.max(bottom, bestRect.y + itemHeight);

      // Remove the used space and split remaining space
      const usedRect = {
        x: bestRect.x,
        y: bestRect.y,
        width: itemWidth,
        height: itemHeight,
      };
      freeRects = subtractRect(freeRects, usedRect);
    } else {
      // Oversized items occupy their own row; reserve it before placing the next item.
      slots.push(0, bottom);
      freeRects = subtractRect(freeRects, {
        x: 0,
        y: bottom,
        width: gridWidth,
        height: itemHeight,
      });
      bottom += itemHeight;
    }
  }

  return slots;
}

/**
 * Subtract a rectangle from a list of free rectangles.
 * Returns new free rectangles representing remaining space.
 */
function subtractRect(freeRects: FreeRect[], used: FreeRect): FreeRect[] {
  const result: FreeRect[] = [];

  for (const rect of freeRects) {
    // Check if rectangles overlap
    if (
      used.x >= rect.x + rect.width ||
      used.x + used.width <= rect.x ||
      used.y >= rect.y + rect.height ||
      used.y + used.height <= rect.y
    ) {
      // No overlap, keep original rect
      result.push(rect);
      continue;
    }

    // Split the rect into up to 4 pieces around the used area

    // Left piece
    if (used.x > rect.x) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: used.x - rect.x,
        height: rect.height,
      });
    }

    // Right piece
    if (used.x + used.width < rect.x + rect.width) {
      result.push({
        x: used.x + used.width,
        y: rect.y,
        width: rect.x + rect.width - (used.x + used.width),
        height: rect.height,
      });
    }

    // Top piece
    if (used.y > rect.y) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: used.y - rect.y,
      });
    }

    // Bottom piece
    if (used.y + used.height < rect.y + rect.height) {
      result.push({
        x: rect.x,
        y: used.y + used.height,
        width: rect.width,
        height: rect.y + rect.height - (used.y + used.height),
      });
    }
  }

  // Remove redundant rectangles (fully contained in others)
  return pruneRects(result);
}

/**
 * Remove rectangles that are fully contained within other rectangles.
 */
function pruneRects(rects: FreeRect[]): FreeRect[] {
  const result: FreeRect[] = [];

  for (let i = 0; i < rects.length; i++) {
    let isContained = false;

    for (let j = 0; j < rects.length; j++) {
      if (i !== j && isRectContained(rects[i], rects[j])) {
        isContained = true;
        break;
      }
    }

    if (!isContained) {
      result.push(rects[i]);
    }
  }

  return result;
}

/**
 * Check if rect A is fully contained within rect B.
 */
function isRectContained(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height
  );
}

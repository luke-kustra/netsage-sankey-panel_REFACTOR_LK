import React from 'react';
import { VizTooltipContainer } from '@grafana/ui';

/**
 * Describes what is currently hovered and where to draw the tooltip. Hover state is owned by
 * <Sankey> and passed down here; this component is purely presentational.
 */
export interface HoverBase {
  content: React.ReactNode;
  /** Cursor position (viewport coords) used to place the tooltip. */
  x: number;
  y: number;
}
export type HoverState =
  | (HoverBase & { kind: 'link'; linkId: string })
  | (HoverBase & { kind: 'node'; rowIds: string[] });

interface TooltipProps {
  hover: HoverState | null;
}

/**
 * Renders the hover tooltip using Grafana's own `VizTooltipContainer`, so it is theme-aware
 * and positioned via a portal.
 *
 * This replaces the previous implementation, which imperatively appended a hardcoded dark
 * `<div>` to `document.body` with D3, re-bound all mouse handlers on every render, and could
 * leak orphan tooltip nodes. The rendered content (row path / "name: value") is unchanged.
 */
export const Tooltip: React.FC<TooltipProps> = ({ hover }) => {
  if (!hover) {
    return null;
  }

  return (
    <VizTooltipContainer position={{ x: hover.x, y: hover.y }} offset={{ x: 10, y: 10 }}>
      {hover.content}
    </VizTooltipContainer>
  );
};

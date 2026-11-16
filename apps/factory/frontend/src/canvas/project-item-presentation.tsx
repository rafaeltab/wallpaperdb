import { memo } from 'react';
import type { CanvasItem, CanvasMetadata } from './view-model';
import type { TitleMode } from './geometry-types';
import {
  Identity,
  CanvasThread,
  Status,
  Fields,
  Labels,
  ParentTag,
  CanvasEvidence,
} from './canvas-presentation';

/** Selection changes the outer item; unchanged content keeps its render lifetime. */
export const ProjectItemPresentation = memo(function ProjectItemPresentation({
  item,
  metadata,
  titleMode,
  titleExpanded,
  parentExpanded,
  parentHighlighted,
}: {
  item: CanvasItem;
  metadata: CanvasMetadata;
  titleMode: TitleMode;
  titleExpanded: boolean;
  parentExpanded: boolean;
  parentHighlighted: boolean;
}) {
  const title = (
    <span
      className="cc-title"
      data-expanded={titleExpanded}
      data-expand-title={titleMode === 'expand' ? `issue:${item.id}` : undefined}
      data-tip={titleMode === 'expand' ? undefined : metadata.title}
    >
      {metadata.title}
    </span>
  );
  return item.pr ? (
    <>
      <div className="cc-pr-top">
        <Identity item={item} />
        <CanvasThread item={item} />
        {title}
        <Status status={item.status} active={item.active} />
        <Fields id={item.id} />
      </div>
      <div className="cc-pr-bottom">
        <Labels id={item.id} />
        <ParentTag
          parent={item.parent}
          nameKey={`badge:${item.id}`}
          mode={titleMode}
          expanded={parentExpanded}
          highlighted={parentHighlighted}
        />
        <CanvasEvidence item={item} />
      </div>
    </>
  ) : (
    <>
      <div className="cc-issue-top">
        <Identity item={item} />
        <CanvasThread item={item} />
        <Status status={item.status} active={item.active} />
        <Fields id={item.id} />
      </div>
      {title}
      {(!!metadata.labels.length || !metadata.labelsKnown) && (
        <div className="cc-issue-bottom">
          <Labels id={item.id} />
        </div>
      )}
    </>
  );
});

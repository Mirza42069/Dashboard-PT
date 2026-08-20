"use client";

import { InfoIcon } from "@DashboardV2/ui/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * An explanation, folded into an icon.
 *
 * Prose that restates its own heading is deleted rather than moved in here.
 * What belongs here is the other kind: a rule the interface cannot show and the
 * reader cannot infer — that a figure is cumulative, that a blank is not a
 * zero, that the previous baseline keeps serving reports until this one is
 * activated. Those have to stay somewhere, but they do not have to be a
 * paragraph the fluent user re-reads every visit.
 *
 * Generalised from the pattern already in delay-contributors.tsx, which was the
 * only place in the product doing this.
 */
export function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              className,
            )}
            // The tooltip is not reachable by a screen reader, so the text is
            // the control's own name rather than a description of it.
            aria-label={text}
          />
        }
      >
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

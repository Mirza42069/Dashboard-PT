"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * Use this instead of Tooltip whenever the trigger's only job is to reveal the
 * popup — an "i"/"!" marker next to a control, say. Base UI disables tooltips
 * on touch devices outright, so anything explanatory hidden in one simply does
 * not exist on a tablet. A popover opens on tap, hover and keyboard alike.
 *
 * Its own rule of thumb: if the trigger exists to open the popup it is a
 * popover; if the popup merely labels a trigger that does something else (the
 * collapsed sidebar rail, for instance) a tooltip is right.
 *
 * Surface tokens follow dropdown-menu.tsx rather than tooltip.tsx: this is a
 * popover-layer surface, not an inverted tooltip chip.
 */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 w-fit max-w-xs origin-(--transform-origin) rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };

"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "@DashboardV2/ui/components/icons";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Theme is passed in by the app, which reads it from a cookie server-side. */
const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      // Defaults, not hard-coded: both sit before {...props} so a call site can
      // still override them.
      //
      // Sonner's own default is bottom-right, which put notifications in the
      // corner furthest from where anything is triggered here — actions live in
      // the header and in table rows near the top of the page.
      //
      // The offset clears the 3rem header rather than floating over it. Toasts
      // are allowed to overlap content, but the header holds the sidebar toggle
      // and company switcher, and a toast landing on top of the control that
      // just fired it is the one overlap worth avoiding.
      //
      // mobileOffset is not redundant. Sonner writes the two through
      // assignOffset(offset, mobileOffset) into separate custom properties and
      // falls back to its own 16px below the mobile breakpoint, so `offset`
      // alone is a desktop-only setting — on a phone the toast would land back
      // on top of the header this is meant to clear.
      position="top-center"
      offset="4rem"
      mobileOffset="4rem"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

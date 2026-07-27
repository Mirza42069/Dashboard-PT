"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Input } from "@DashboardV2/ui/components/input";
import { cn } from "@DashboardV2/ui/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n/provider";

/**
 * Password field with a show/hide eye. The toggle is tabIndex={-1} so keyboard
 * flow stays field → submit; mouse/touch users can still reveal what they typed.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        tabIndex={-1}
        aria-label={visible ? t.common.hidePassword : t.common.showPassword}
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:bg-transparent"
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

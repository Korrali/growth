"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  loadingLabel?: string;
}

export function SubmitButton({
  children,
  loadingLabel,
  disabled,
  className,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      className={cn(className)}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          {loadingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

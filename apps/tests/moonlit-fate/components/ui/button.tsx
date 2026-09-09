import * as React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant: _variant, size: _size, ...props }, ref) => (
  <button ref={ref} className={className} {...props} />
  ),
);

Button.displayName = "Button";

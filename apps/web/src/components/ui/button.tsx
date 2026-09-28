"use client";

import Link from "next/link";
import { motion, useMotionValue, useSpring, type HTMLMotionProps } from "motion/react";
import { useCallback, useRef, type ReactNode } from "react";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "accent" | "glass" | "ghost" | "danger" | "outline" | "volt";
type Size = "sm" | "md" | "lg" | "xl" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-ink-50 text-ink-950 shadow-[0_8px_30px_-8px_rgb(255_255_255/0.35)] hover:bg-white",
  accent:
    "text-white bg-[linear-gradient(110deg,var(--color-nova-500),var(--color-violet-glow)_55%,var(--color-flare))] bg-[length:180%_100%] hover:bg-[position:100%_0] shadow-[0_10px_40px_-10px_rgb(123_97_255/0.8)]",
  volt: "bg-volt text-ink-950 shadow-[0_10px_40px_-12px_rgb(198_255_61/0.7)] hover:brightness-105",
  glass: "glass text-ink-50 hover:bg-white/10",
  ghost: "text-ink-200 hover:text-ink-50 hover:bg-white/[0.06]",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
  outline: "border border-white/15 text-ink-50 hover:border-white/30 hover:bg-white/[0.04]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
  md: "h-10 px-4 text-sm gap-2 rounded-full",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-full",
  xl: "h-14 px-8 text-base gap-2.5 rounded-full",
  icon: "size-10 rounded-full",
  "icon-sm": "size-8 rounded-full",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Gently follows the pointer. */
  magnetic?: boolean;
  /** Plays a soft UI sound on press. */
  sound?: boolean;
  children?: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps & Omit<HTMLMotionProps<"button">, "children"> & { href?: undefined };
type LinkProps = CommonProps & { href: string; prefetch?: boolean; target?: string; rel?: string; onClick?: () => void; "aria-label"?: string; transitionTypes?: string[] };

const MotionLink = motion.create(Link);

function useMagnet(enabled: boolean) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, spring.snappy);
  const sy = useSpring(y, spring.snappy);
  const ref = useRef<HTMLElement | null>(null);
  const setRef = useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.pointerType !== "mouse" || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      x.set(((event.clientX - rect.left) / rect.width - 0.5) * 12);
      y.set(((event.clientY - rect.top) / rect.height - 0.5) * 10);
    },
    [enabled, x, y],
  );
  const onPointerLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);
  return { setRef, style: enabled ? { x: sx, y: sy } : undefined, onPointerMove, onPointerLeave };
}

export function Button(props: ButtonProps | LinkProps) {
  const {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    iconRight,
    magnetic = false,
    sound = true,
    className,
    children,
    ...rest
  } = props;
  const { setRef, style: magnetStyle, onPointerMove, onPointerLeave } = useMagnet(magnetic);
  const classes = cn(
    "relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold tracking-tight",
    "transition-[background-color,background-position,color,border-color,filter,box-shadow] duration-300 ease-out",
    "disabled:opacity-50 disabled:saturate-50",
    variants[variant],
    sizes[size],
    className,
  );
  const content = (
    <>
      {loading ? <Spinner className="size-4" /> : icon}
      {children !== undefined && <span className="relative">{children}</span>}
      {!loading && iconRight}
    </>
  );
  const motionProps = {
    whileTap: { scale: 0.95 },
    whileHover: { scale: 1.02 },
    transition: spring.snappy,
    style: magnetStyle,
    onPointerMove,
    onPointerLeave,
  };

  if ("href" in rest && typeof rest.href === "string") {
    const { href, onClick, ...linkRest } = rest as LinkProps;
    return (
      <MotionLink
        href={href}
        ref={setRef}
        className={classes}
        onClick={() => {
          if (sound) play("pop");
          onClick?.();
        }}
        {...motionProps}
        {...linkRest}
      >
        {content}
      </MotionLink>
    );
  }

  const { onClick, disabled, type, ...buttonRest } = rest as ButtonProps;
  return (
    <motion.button
      ref={setRef}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      onClick={(event) => {
        if (sound) play("pop");
        onClick?.(event);
      }}
      {...motionProps}
      {...buttonRest}
    >
      {content}
    </motion.button>
  );
}

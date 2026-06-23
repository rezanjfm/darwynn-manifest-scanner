"use client";

import { useState } from "react";

type LogoProps = {
  /** "light" = full-colour logo on a light background.
   *  "dark"  = white-tinted logo for use on dark/navy headers. */
  variant?: "light" | "dark";
  className?: string;
  /** Tailwind height class — defaults to h-9 */
  height?: string;
};

export default function Logo({ variant = "light", className = "", height = "h-9" }: LogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (!imgFailed) {
    return (
      <img
        src="/logo.png"
        alt="Darwynn"
        className={`${height} w-auto object-contain ${variant === "dark" ? "brightness-0 invert" : ""} ${className}`}
        style={variant === "dark" ? { filter: "brightness(0) invert(1)" } : undefined}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Text fallback while logo.png hasn't been added yet
  return (
    <div className={`flex flex-col justify-center leading-none select-none ${className}`}>
      <span
        className={`font-black text-xl tracking-tight ${variant === "dark" ? "text-white" : "text-gray-900"}`}
      >
        Darwynn
      </span>
      <span className="text-[10px] font-semibold tracking-wide" style={{ color: "#00B2D8" }}>
        e-commerce evolutionism
      </span>
    </div>
  );
}

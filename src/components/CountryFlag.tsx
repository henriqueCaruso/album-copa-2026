import React, { useState } from "react";

interface CountryFlagProps {
  iso2: string;
  name: string;
  fifaCode: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function CountryFlag({ iso2, name, fifaCode, className = "", size = "md" }: CountryFlagProps) {
  const [error, setError] = useState(false);

  // Sizing definitions matching aspect-ratio 4:3 closely to avoid Cumulative Layout Shift
  const sizeClasses = {
    sm: "w-6 h-4 text-[9px] leading-none",
    md: "w-10 h-7 text-[10px] leading-none",
    lg: "w-14 h-10 text-[12px] leading-none"
  }[size];

  const width = size === "sm" ? 24 : size === "md" ? 40 : 56;
  const height = size === "sm" ? 16 : size === "md" ? 28 : 40;

  // CDN URLs
  const flagUrl = `https://flagcdn.com/w80/${iso2.toLowerCase()}.png`;
  const flagUrl2x = `https://flagcdn.com/w160/${iso2.toLowerCase()}.png`;

  if (fifaCode === "FWC" || fifaCode === "CC" || error || !iso2 || iso2 === "un") {
    const isGold = fifaCode === "FWC";
    const isRed = fifaCode === "CC";
    return (
      <div
        className={`flex items-center justify-center font-black select-none rounded border shrink-0 text-center uppercase tracking-tighter ${sizeClasses} ${
          isGold
            ? "bg-amber-950/80 text-[#d4af37] border-[#d4af37]/35"
            : isRed
            ? "bg-rose-950/80 text-rose-300 border-rose-500/35"
            : "bg-stone-900 text-stone-400 border-stone-800"
        } ${className}`}
        style={{ width, height }}
        title={name}
      >
        {fifaCode}
      </div>
    );
  }

  return (
    <img
      src={flagUrl}
      srcSet={`${flagUrl} 1x, ${flagUrl2x} 2x`}
      alt={`Bandeira de ${name}`}
      loading="lazy"
      onError={() => setError(true)}
      className={`object-cover rounded border border-stone-800/40 shrink-0 ${sizeClasses} ${className}`}
      width={width}
      height={height}
    />
  );
}

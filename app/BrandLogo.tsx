import Image from "next/image";

export type BrandLogoName = "general" | "suyai" | "aura";

const logos = {
  general: { src: "/brands/p-delivery.png", alt: "P-delivery" },
  suyai: { src: "/brands/suyai.png", alt: "Suyai" },
  aura: { src: "/brands/aura.png", alt: "Aura Premium Oil" },
} as const;

export function BrandLogo({
  brand = "general",
  className = "",
  priority = false,
}: {
  brand?: BrandLogoName;
  className?: string;
  priority?: boolean;
}) {
  const logo = logos[brand];

  return (
    <span className={`brand-logo brand-logo-${brand} ${className}`.trim()}>
      <Image
        src={logo.src}
        alt={logo.alt}
        width={96}
        height={96}
        priority={priority}
      />
    </span>
  );
}

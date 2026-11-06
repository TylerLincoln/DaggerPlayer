// Domain icons (SRD 2.0 Public Game Content) are alpha masks; CSS paints them in the current text colour.
const ICONS = import.meta.glob<string>("/content/*/icons/*.png", { eager: true, query: "?url", import: "default" });

export function iconUrl(pack: string, icon: string | undefined): string | undefined {
  return icon ? ICONS[`/content/${pack}/${icon}`] : undefined;
}

export function DomainIcon({ pack, icon, size = 24, label }: { pack: string; icon?: string; size?: number; label?: string }) {
  const url = iconUrl(pack, icon);
  if (!url) return null;
  return (
    <span
      className="domain-icon"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
    />
  );
}

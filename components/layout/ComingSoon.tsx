import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-lime/20 to-moss/20">
        <Icon className="h-6 w-6 text-lime-soft" />
      </div>
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-faint">{description}</p>
    </div>
  );
}

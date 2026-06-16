import { VALID_SLUGS } from "@/lib/date-range";
import type { PeriodSlug } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<PeriodSlug, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "6m": "Last 6 months",
  ytd: "Year to date",
  all: "All time",
};

interface Props {
  period: PeriodSlug;
  onPeriodChange: (slug: PeriodSlug) => void;
}

export function PeriodSelector({ period, onPeriodChange }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          {LABELS[period]}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {VALID_SLUGS.map((slug) => (
          <DropdownMenuItem
            key={slug}
            onClick={() => {
              onPeriodChange(slug);
            }}
            className={cn("gap-2", slug === period && "font-medium")}
          >
            <Check className={cn("size-3.5", slug === period ? "opacity-100" : "opacity-0")} />
            {LABELS[slug]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

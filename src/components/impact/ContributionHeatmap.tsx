import { Skeleton } from "@/components/ui/skeleton";
import type { DailyActivity } from "@/types";

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const WEEKS = 53;
const DAYS = 7;
const LEFT_MARGIN = 28;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function intensityClass(count: number, max: number): string {
  if (count === 0 || max === 0) return "fill-white/5";
  const ratio = count / max;
  if (ratio < 0.2) return "fill-purple-500/20";
  if (ratio < 0.4) return "fill-purple-500/40";
  if (ratio < 0.7) return "fill-purple-500/60";
  return "fill-purple-500/90";
}

interface Props {
  data: DailyActivity[] | null;
  loading: boolean;
}

export function ContributionHeatmap({ data, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-28 w-full bg-white/10" />;
  }

  const dateMap = new Map<string, number>((data ?? []).map((d) => [d.date, d.count]));
  const max = Math.max(0, ...(data ?? []).map((d) => d.count));

  // Build a 53-week grid ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  const gridEnd = new Date(today);

  const cells: { date: string; count: number; col: number; row: number }[] = [];
  for (let col = WEEKS - 1; col >= 0; col--) {
    for (let row = 6; row >= 0; row--) {
      const daysBack = (WEEKS - 1 - col) * 7 + (dayOfWeek - row);
      const d = new Date(gridEnd);
      d.setDate(d.getDate() - daysBack);
      if (d > today) continue;
      const iso = d.toISOString().slice(0, 10);
      cells.push({ date: iso, count: dateMap.get(iso) ?? 0, col, row });
    }
  }

  // Month labels: place at the column where the 1st of each month falls
  const monthLabels: { col: number; label: string }[] = [];
  const seenMonths = new Set<string>();
  for (const cell of cells) {
    const d = new Date(cell.date);
    if (d.getDate() === 1) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!seenMonths.has(key)) {
        seenMonths.add(key);
        monthLabels.push({ col: cell.col, label: d.toLocaleString("en", { month: "short" }) });
      }
    }
  }
  monthLabels.sort((a, b) => a.col - b.col);

  const svgW = LEFT_MARGIN + WEEKS * STEP;
  const svgH = 16 + DAYS * STEP;

  return (
    <div className="flex justify-center overflow-x-auto">
      <svg width={svgW} height={svgH} aria-label="Contribution heatmap">
        {/* month labels */}
        {monthLabels.map(({ col, label }) => (
          <text key={`${col}-${label}`} x={LEFT_MARGIN + col * STEP} y={10} fontSize={9} fill="rgba(255,255,255,0.4)">
            {label}
          </text>
        ))}
        {/* day labels */}
        {DAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={i}
              x={LEFT_MARGIN - 4}
              y={16 + i * STEP + CELL}
              fontSize={9}
              fill="rgba(255,255,255,0.4)"
              textAnchor="end"
            >
              {label}
            </text>
          ) : null,
        )}
        {/* cells */}
        {cells.map(({ date, count, col, row }) => (
          <rect
            key={date}
            x={LEFT_MARGIN + col * STEP}
            y={16 + row * STEP}
            width={CELL}
            height={CELL}
            rx={2}
            className={intensityClass(count, max)}
          >
            <title>
              {date}: {count} contribution{count !== 1 ? "s" : ""}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodSelector } from "@/components/impact/PeriodSelector";
import { KpiCards } from "@/components/impact/KpiCards";
import type { ImpactSummary } from "@/types";

const MOCK_SUMMARY: ImpactSummary = {
  prsAuthored: { value: 12, delta: 20 },
  reviewsGiven: { value: 8, delta: -10 },
  threadsStarted: { value: 5, delta: null },
  medianTimeToMerge: { value: 36, delta: null },
  medianPickupTime: { value: 2.5, delta: 5 },
  discussionRatio: { value: 62, delta: 0 },
  lastSyncedAt: "2026-06-16T10:00:00Z",
};

describe("PeriodSelector", () => {
  it("PS1: renders the current period label", () => {
    render(<PeriodSelector period="90d" onPeriodChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /last 90 days/i })).toBeInTheDocument();
  });

  it("PS2: calls onPeriodChange with the selected slug when an option is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PeriodSelector period="90d" onPeriodChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /last 90 days/i }));
    await user.click(screen.getByText("Last 7 days"));

    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("PS3: active period item has visible check icon; inactive items do not", async () => {
    const user = userEvent.setup();
    render(<PeriodSelector period="30d" onPeriodChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    const items = screen.getAllByRole("menuitem");
    // VALID_SLUGS order: 7d(0), 30d(1), 90d(2), 6m(3), ytd(4), all(5)
    // Active item (index 1 = 30d) renders check with opacity-100
    expect(items[1].querySelector("svg")).toHaveClass("opacity-100");
    // Inactive item (index 0 = 7d) renders check with opacity-0
    expect(items[0].querySelector("svg")).toHaveClass("opacity-0");
  });

  it("PS4: all 6 period options are listed in the dropdown", async () => {
    const user = userEvent.setup();
    render(<PeriodSelector period="90d" onPeriodChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /last 90 days/i }));
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
    // "Last 90 days" appears in both trigger and menu — check at least 2
    expect(screen.getAllByText("Last 90 days").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Last 6 months")).toBeInTheDocument();
    expect(screen.getByText("Year to date")).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();
  });
});

describe("KpiCards", () => {
  it("KC1: renders 6 skeleton cards while loading", () => {
    const { container } = render(<KpiCards summary={null} loading={true} />);
    // Each card renders skeletons when loading; we check that card wrappers exist
    const cards = container.querySelectorAll(".rounded-xl");
    expect(cards.length).toBe(6);
  });

  it("KC2: renders the PR count from summary data", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("KC3: shows positive delta in green and negative delta in red", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    const positive = screen.getByText("+20%");
    expect(positive).toHaveClass("text-emerald-400");
    const negative = screen.getByText("-10%");
    expect(negative).toHaveClass("text-red-400");
  });

  it("KC4: shows — for null delta", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    // threadsStarted and medianTimeToMerge have null deltas → rendered as "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("KC5: formats time values in hours/days when unit is hours", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    // medianTimeToMerge = 36h → 36 >= 24 → converted to "1.5d"
    // medianPickupTime = 2.5h → 2.5 < 24 → stays as "2.5h"
    expect(screen.getByText("1.5d")).toBeInTheDocument();
    expect(screen.getByText("2.5h")).toBeInTheDocument();
  });

  it("KC6: formats discussion ratio with % suffix", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    expect(screen.getByText("62%")).toBeInTheDocument();
  });

  it("KC7: renders all 6 card labels", () => {
    render(<KpiCards summary={MOCK_SUMMARY} loading={false} />);
    expect(screen.getByText(/PRs authored/i)).toBeInTheDocument();
    expect(screen.getByText(/Reviews given/i)).toBeInTheDocument();
    expect(screen.getByText(/Threads started/i)).toBeInTheDocument();
    expect(screen.getByText(/Time to merge/i)).toBeInTheDocument();
    expect(screen.getByText(/Pickup time/i)).toBeInTheDocument();
    expect(screen.getByText(/Discussion ratio/i)).toBeInTheDocument();
  });
});

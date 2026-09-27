/** @vitest-environment jsdom */
/**
 * The kept Beautiful UI primitives render exactly what they are given: no
 * built-in content, no timers or staged reveals, and nothing at all when their
 * lists are empty. Values below are test inputs, not product data.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextCards from "@/components/primitives/ContextCards";
import InsightCards from "@/components/primitives/InsightCards";
import LoadingState from "@/components/primitives/LoadingState";
import PromptBar from "@/components/primitives/PromptBar";
import RecordsTable, { type RecordsColumn } from "@/components/primitives/RecordsTable";
import SidebarNav from "@/components/primitives/SidebarNav";
import StreamingText from "@/components/primitives/StreamingText";
import ThinkingState from "@/components/primitives/ThinkingState";
import ToolChips from "@/components/primitives/ToolChips";

/* vitest runs without globals, so Testing Library cannot register its own cleanup */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("empty inputs render nothing", () => {
  it.each([
    ["ContextCards", <ContextCards key="c" header="Sources" chunks={[]} />],
    ["ToolChips", <ToolChips key="t" header="Calculations" steps={[]} />],
    ["InsightCards", <InsightCards key="i" title="Insights" pages={[]} />],
    ["RecordsTable", <RecordsTable key="r" label="Periods" columns={[]} rows={[]} rowKey={() => ""} />],
  ])("%s", (_name, element) => {
    const { container } = render(element);
    expect(container.innerHTML).toBe("");
  });
});

describe("ThinkingState", () => {
  it("renders exactly the given steps with their statuses, and nothing changes as time passes", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ThinkingState
        label="Researching"
        active
        steps={[
          { id: "a", label: "Read the latest quarterly filing", status: "done" },
          { id: "b", label: "Fetching price history", status: "active", detail: "1 source" },
        ]}
      />,
    );
    const before = container.innerHTML;
    expect(screen.getByText("Read the latest quarterly filing")).toBeTruthy();
    expect(screen.getByText("Fetching price history")).toBeTruthy();
    expect(screen.getAllByLabelText("Done")).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "In progress" })).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.innerHTML).toBe(before);
  });

  it("is open while active, collapses when settled, and a header with no trace is not a toggle", () => {
    const steps = [{ id: "a", label: "Read filing", status: "done" as const }];
    const { rerender } = render(<ThinkingState label="Researching" active steps={steps} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    rerender(<ThinkingState label="Researched 1 source" active={false} steps={steps} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    cleanup();
    render(<ThinkingState label="Waiting for the synthesis model" active steps={[]} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks a stopped step without a check or a spinner", () => {
    render(
      <ThinkingState
        label="Analysis cancelled"
        active={false}
        defaultExpanded
        steps={[
          { id: "a", label: "Scoring the evidence", status: "done" },
          { id: "b", label: "Writing the assessment", status: "stopped" },
        ]}
      />,
    );
    expect(screen.getAllByLabelText("Done")).toHaveLength(1);
    expect(screen.getAllByLabelText("Stopped")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "In progress" })).toBeNull();
  });
});

describe("StreamingText", () => {
  it("shows the received text verbatim with a caret, and never reveals it on a timer", () => {
    vi.useFakeTimers();
    const text = "Revenue grew\n  quarter over quarter.";
    const { container, rerender } = render(<StreamingText content={text} streaming />);
    const paragraph = container.querySelector("p")!;
    expect(paragraph.textContent).toBe(text);
    expect(paragraph.getAttribute("aria-busy")).toBe("true");
    const before = container.innerHTML;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(container.innerHTML).toBe(before);
    rerender(<StreamingText content={text} streaming={false} />);
    expect(container.querySelector("p")!.getAttribute("aria-busy")).toBe("false");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector("img, video")).toBeNull();
  });

  it("renders inline citations and the sources list only from given sources", () => {
    render(
      <StreamingText
        content={[{ text: "Margins widened " }, { cite: "s1" }, { text: "." }]}
        streaming={false}
        sources={[{ id: "s1", name: "Quarterly report", domain: "example.com", href: "https://example.com/q" }]}
      />,
    );
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /1 source/ })).toBeTruthy();
  });
});

describe("LoadingState", () => {
  it("shows its label and wall-clock elapsed time, with no media", () => {
    vi.useFakeTimers();
    const { container } = render(<LoadingState label="Checking backend capabilities" />);
    expect(screen.getByText("Checking backend capabilities")).toBeTruthy();
    expect(screen.getByText("0.0s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByText("1.5s")).toBeTruthy();
    expect(container.querySelector("video, img")).toBeNull();
  });
});

describe("SidebarNav", () => {
  it("shows only the workspace name and collapse controls when given nothing else", () => {
    render(<SidebarNav workspaceName="BayAnalytics" />);
    expect(screen.getByText("BayAnalytics")).toBeTruthy();
    /* "Expand sidebar" is aria-hidden while the sidebar is open */
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Collapse sidebar"]);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Workspace navigation" }).textContent).toBe("BayAnalytics");
  });

  it("renders given nav items, history and footer, and reports picks", () => {
    const onPick = vi.fn();
    const onNew = vi.fn();
    render(
      <SidebarNav
        workspaceName="BayAnalytics"
        newLabel="New analysis"
        onNew={onNew}
        navItems={[{ key: "history", label: "History", icon: <span /> }]}
        recents={[{ id: "an_1", label: "First analysis" }]}
        labels={{ recents: "History" }}
        footerLabel="Settings"
        onFooterClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("New analysis"));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Settings")).toBeTruthy();
    cleanup();
    render(<SidebarNav workspaceName="W" recents={[{ id: "an_2", label: "Second" }]} onPick={onPick} />);
    fireEvent.click(screen.getByText("Second"));
    expect(onPick).toHaveBeenCalledWith("an_2", "Second", undefined);
  });

  it("selects by id, shows a row's detail and the caller's footer", () => {
    render(
      <SidebarNav
        workspaceName="W"
        recents={[
          { id: "an_1", label: "Same question", detail: "AAPL" },
          { id: "an_2", label: "Same question", detail: "AAPL · Failed" },
        ]}
        activeId="an_2"
        recentsFooter={<button type="button">Load more</button>}
        recentsEmpty={<p>Nothing yet</p>}
      />,
    );
    const rows = screen.getAllByTitle("Same question");
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(rows[1].textContent).toBe("Same questionAAPL · Failed");
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(screen.queryByText("Nothing yet")).toBeNull();
  });

  it("shows the caller's empty state only when there are no rows", () => {
    render(<SidebarNav workspaceName="W" recents={[]} recentsEmpty={<p>Nothing yet</p>} recentsFooter={<span>footer</span>} />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.queryByText("footer")).toBeNull();
  });

  it("can have its collapse controlled by the caller", () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(<SidebarNav workspaceName="W" collapsed={false} onCollapsedChange={onCollapsedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    /* still open: the caller decides */
    expect(screen.getByRole("complementary").getAttribute("data-sidebar-collapsed")).toBe("false");
    rerender(<SidebarNav workspaceName="W" collapsed onCollapsedChange={onCollapsedChange} />);
    expect(screen.getByRole("complementary").getAttribute("data-sidebar-collapsed")).toBe("true");
  });
});

describe("PromptBar", () => {
  it("has only a send button by default and sends the trimmed draft on Enter", () => {
    const onSend = vi.fn();
    render(<PromptBar placeholder="Ask about a public company…" onSend={onSend} />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Send"]);
    const input = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  Assess the company.  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Assess the company.");
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "@" } });
    expect(screen.queryByText(/No matches/)).toBeNull(); /* no mentions given, no @ menu */
  });

  it("does not send while sendDisabled", () => {
    const onSend = vi.fn();
    render(<PromptBar placeholder="p" onSend={onSend} sendDisabled />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the given options, refuses a disabled one and shows its reason", () => {
    const onSelectOption = vi.fn();
    render(
      <PromptBar
        placeholder="p"
        onSend={() => {}}
        optionsLabel="Analysis profile"
        options={[
          { key: "fast", name: "Fast" },
          { key: "deep", name: "Deep", disabled: true, disabledReason: "Not available on this machine right now." },
        ]}
        selectedOption="fast"
        onSelectOption={onSelectOption}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Analysis profile: Fast" }));
    const menu = screen.getByRole("menu", { name: "Analysis profile" });
    expect(within(menu).getByText("Not available on this machine right now.")).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Deep/ }));
    expect(onSelectOption).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Fast/ }));
    expect(onSelectOption).toHaveBeenCalledWith("fast");
  });

  it("drives dictation from the caller's state and accepts a controlled draft", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <PromptBar placeholder="p" onSend={() => {}} value="" dictation={{ listening: false, onToggle }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<PromptBar placeholder="p" onSend={() => {}} value="transcribed question" dictation={{ listening: true, onToggle }} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("transcribed question");
    expect(screen.getByRole("button", { name: "Stop dictation" })).toBeTruthy();
  });
});

describe("RecordsTable", () => {
  type Period = { id: string; label: string; value: number | null };
  const columns: RecordsColumn<Period>[] = [
    { key: "label", header: "Period", cell: (r) => r.label, sortValue: (r) => r.label },
    { key: "value", header: "Value", cell: (r) => (r.value === null ? "—" : String(r.value)), sortValue: (r) => r.value, align: "end", numeric: true, footer: "3 rows" },
  ];
  const rows: Period[] = [
    { id: "b", label: "B", value: 2 },
    { id: "a", label: "A", value: null },
    { id: "c", label: "C", value: 1 },
  ];
  const firstColumn = () => screen.getAllByRole("row").slice(1, 4).map((row) => row.querySelector("td")!.textContent);

  it("renders the given cells in the given order until a header is clicked", () => {
    render(<RecordsTable label="Periods" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(firstColumn()).toEqual(["B", "A", "C"]);
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(firstColumn()).toEqual(["C", "B", "A"]); /* missing values last */
    expect(screen.getByRole("columnheader", { name: /Value/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(firstColumn()).toEqual(["B", "C", "A"]); /* still last when descending */
    expect(screen.getByText("3 rows")).toBeTruthy();
  });

  it("selects rows when selectable", () => {
    const onSelectionChange = vi.fn();
    render(<RecordsTable label="Periods" columns={columns} rows={rows} rowKey={(r) => r.id} selectable onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["b", "a", "c"]);
  });
});

describe("ToolChips and ContextCards", () => {
  it("ToolChips shows every given row at once; only rows with detail expand", () => {
    vi.useFakeTimers();
    render(
      <ToolChips
        header="2 calculations"
        steps={[
          { id: "g", icon: "calc", label: "Revenue growth", chip: "computed", detail: [{ text: "inputs: two quarters" }] },
          { id: "p", icon: "calc", label: "P/E", chip: "unavailable" },
        ]}
      />,
    );
    expect(screen.getByText("Revenue growth")).toBeTruthy();
    expect(screen.getByText("P/E")).toBeTruthy();
    const growth = screen.getByRole("button", { name: /Revenue growth/ });
    expect(growth.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(growth);
    expect(growth.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: /P\/E/ })).toBeNull();
  });

  it("ContextCards renders the given chunks with their links", () => {
    render(
      <ContextCards
        header="Sources"
        chunks={[{ id: "s1", title: "Quarterly report", meta: "Q2", source: "example.com", href: "https://example.com/q", badge: "10-Q" }]}
      />,
    );
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link.getAttribute("href")).toBe("https://example.com/q");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("1")).toBeTruthy();
  });
});

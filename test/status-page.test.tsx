/** @vitest-environment jsdom */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatusPage from "@/components/finance/StatusPage";
import { capabilitiesFixture, jsonResponse } from "./fixtures/backend";
import { stubBackend } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/status",
}));

afterEach(cleanup);

describe("StatusPage", () => {
  it("renders the backend status panel with loaded capabilities", async () => {
    const backend = stubBackend({
      "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
      "GET /analyses": () => jsonResponse(200, { analyses: [], next_cursor: null }),
    });
    renderWorkspace(<StatusPage />, { client: backend.client });

    expect(await screen.findByText("Deployment")).toBeTruthy();
  });
});

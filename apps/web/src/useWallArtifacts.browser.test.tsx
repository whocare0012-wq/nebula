import type { EnvironmentId, WallArtifact } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../test/render";
import { loadWallArtifacts } from "./lib/artifactWallClient";
import { useWallArtifacts } from "./useWallArtifacts";

vi.mock("./lib/artifactWallClient", () => ({ loadWallArtifacts: vi.fn() }));
vi.mock("./state/session", () => ({ usePreparedConnection: () => null }));

function Reader({ threadId }: { threadId: string }) {
  const state = useWallArtifacts("environment-local" as EnvironmentId, threadId);
  return <output>{state.loading ? "loading" : (state.error ?? state.artifacts.length)}</output>;
}

function Readers({
  second = true,
  threadId = "shared-collection",
}: {
  second?: boolean;
  threadId?: string;
}) {
  return (
    <div>
      <Reader key="main" threadId={threadId} />
      {second ? <Reader key="wall" threadId={threadId} /> : null}
    </div>
  );
}

it("shares the pending request and cancels only after the final consumer leaves", async () => {
  const load = vi.mocked(loadWallArtifacts).mockReset();
  load.mockImplementation(() => new Promise(() => {}));
  await using screen = await render(
    <Readers />,
    // Only the collection subscription is exercised; it has no routing dependency.
    { router: false },
  );
  expect(load).toHaveBeenCalledTimes(1);
  const signal = load.mock.calls[0]![3];
  expect(signal.aborted).toBe(false);
  await screen.rerender(<Readers second={false} />);
  expect(load).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  await screen.rerender(<Readers second={false} threadId="another-collection" />);
  expect(signal.aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[1]![1]).toBe("another-collection");
});

it("does not render subscribers for unchanged polls, but publishes metadata edits", async () => {
  const artifact = {
    id: "one",
    name: "one.png",
    path: "/outputs/one.png",
    kind: "image",
    extension: "png",
    source: "path_reference",
    createdAt: "2026-10-25T08:00:00.000Z",
    sizeBytes: 12,
  } as WallArtifact;
  const load = vi.mocked(loadWallArtifacts).mockReset();
  load.mockImplementation(async () => [structuredClone(artifact)]);
  const rendered = vi.fn();
  function Probe() {
    const state = useWallArtifacts("environment-local" as EnvironmentId, "stable-poll");
    rendered(state.artifacts);
    return <output>{state.loading ? "loading" : state.artifacts[0]?.name}</output>;
  }
  // The first successful read arms the collection's poll timer during mounting.
  using _timers = fakeTimers();
  // The collection has no routing dependency.
  await using screen = await render(<Probe />, { router: false });
  await expect.element(screen.getByText("one.png")).toBeInTheDocument();
  const calls = rendered.mock.calls.length;
  const first = rendered.mock.calls.at(-1)![0];
  // A thread's collection polls every 30 seconds.
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(load).toHaveBeenCalledTimes(2);
  expect(rendered).toHaveBeenCalledTimes(calls);
  load.mockResolvedValue([{ ...artifact, name: "renamed.png" }]);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  await expect.element(screen.getByText("renamed.png")).toBeInTheDocument();
  expect(rendered.mock.calls.at(-1)![0]).not.toBe(first);
});

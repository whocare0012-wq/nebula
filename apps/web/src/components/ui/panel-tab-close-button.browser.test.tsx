import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { PanelTabCloseButton } from "./panel-tab-close-button";

function Tab({ onClose }: { readonly onClose: () => void }) {
  return (
    <div data-testid="tab" className="group/tab flex w-48 items-center gap-0.5">
      <PanelTabCloseButton label="Close notes.md" onClick={onClose}>
        <span data-testid="icon" className="size-3" />
      </PanelTabCloseButton>
      <span data-testid="title" className="flex-1">
        notes.md
      </span>
    </div>
  );
}

it.each([
  { platform: "Win32", closeAfterTitle: true },
  { platform: "MacIntel", closeAfterTitle: false },
])("places the close button for $platform", async ({ platform, closeAfterTitle }) => {
  vi.stubGlobal("navigator", { ...navigator, platform });
  using _platform = { [Symbol.dispose]: () => vi.unstubAllGlobals() };
  const onClose = vi.fn();
  await using _screen = await render(<Tab onClose={onClose} />, { router: false });
  const close = page.getByRole("button", { name: "Close notes.md" }).element();
  const title = page.getByTestId("title").element();
  const after = close.getBoundingClientRect().left > title.getBoundingClientRect().left;
  expect(after).toBe(closeAfterTitle);
  // The tab icon stays visible next to a trailing close button instead of being swapped out.
  expect(page.getByTestId("icon").element().isConnected).toBe(true);
  (close as HTMLButtonElement).click();
  expect(onClose).toHaveBeenCalledOnce();
});

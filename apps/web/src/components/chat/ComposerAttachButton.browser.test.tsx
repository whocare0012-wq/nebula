import { GTProvider } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import zh from "../../i18n/translations/zh.json";
import { render } from "../../../test/render";
import { TooltipProvider } from "../ui/tooltip";
import { ComposerAttachButton } from "./ComposerAttachButton";

const button = (onOpenPicker: () => void, disabled = false) => (
  <GTProvider locale="zh" translations={{ zh, en: {} } as never}>
    <TooltipProvider>
      <ComposerAttachButton onOpenPicker={onOpenPicker} disabled={disabled} />
    </TooltipProvider>
  </GTProvider>
);

describe("ComposerAttachButton", () => {
  it("renders V9 30x30 circular '+' button with aria-label and no native title", async () => {
    await using screen = await render(button(vi.fn()));

    const element = screen.getByRole("button", { name: "添加附件" }).element() as HTMLButtonElement;
    expect(element.hasAttribute("title")).toBe(false);
    expect(element.getAttribute("data-v9-sf-btn")).toBe("attach");
    const rect = element.getBoundingClientRect();
    expect(Math.round(rect.width)).toBe(30);
    expect(Math.round(rect.height)).toBe(30);

    const svg = element.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("stroke-width")).toBe("1.8");
    expect(svg!.getAttribute("stroke-linecap")).toBe("round");
  });

  it("opens the composer's file picker, and not while disabled", async () => {
    const onOpenPicker = vi.fn();
    await using screen = await render(button(onOpenPicker));

    await screen.getByRole("button", { name: "添加附件" }).click();
    expect(onOpenPicker).toHaveBeenCalledOnce();

    await screen.rerender(button(onOpenPicker, true));
    const element = screen.getByRole("button", { name: "添加附件" }).element() as HTMLButtonElement;
    expect(element.disabled).toBe(true);
    element.click();
    expect(onOpenPicker).toHaveBeenCalledOnce();
  });
});

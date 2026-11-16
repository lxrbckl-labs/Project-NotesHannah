import { Check, PanelLeft, PanelRight, PanelsTopLeft, RotateCcw } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { IconButton } from "../../../../components/ui/button";
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
} from "../../../../components/ui/menu";
import { closePanel, PANEL_IDS, type PanelId, sideOf } from "./layout";
import type { DockApi } from "./useDock";

export const PANEL_TITLE: Record<PanelId, string> = {
  outline: "Outline",
  resources: "Resources",
  notes: "Side notes",
};

function Item({
  children,
  icon,
  checked,
  onSelect,
  testId,
  disabled,
}: {
  children: ReactNode;
  icon?: ReactNode;
  checked?: boolean;
  onSelect: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
        {checked === undefined ? icon : checked ? <Check /> : null}
      </span>
      <span className="flex-1">{children}</span>
    </>
  );
  return checked === undefined ? (
    <DropdownMenu.Item
      className={menuItemClass()}
      onSelect={onSelect}
      data-testid={testId}
      disabled={disabled}
    >
      {body}
    </DropdownMenu.Item>
  ) : (
    <DropdownMenu.CheckboxItem
      className={menuItemClass()}
      checked={checked}
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      data-testid={testId}
      disabled={disabled}
    >
      {body}
    </DropdownMenu.CheckboxItem>
  );
}

/**
 * The "Panels" button in the document bar: show or hide each sidebar, reopen a closed panel or
 * close one, and go back to the arrangement this kind of screen starts with.
 */
export function PanelsMenu({ dock }: { dock: DockApi }) {
  const hasPanels = (side: "left" | "right") => dock.state[side].panels.length > 0;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Panels" data-testid="panels-button">
          <PanelsTopLeft className="size-[18px]" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Panels"
          className={menuContentClass}
        >
          <Item
            checked={dock.showing("left")}
            disabled={!hasPanels("left")}
            onSelect={() => dock.toggleSide("left")}
            testId="toggle-left-sidebar"
          >
            <span className="inline-flex items-center gap-2">
              <PanelLeft aria-hidden className="size-4 text-text-muted" /> Left sidebar
            </span>
          </Item>
          <Item
            checked={dock.showing("right")}
            disabled={!hasPanels("right")}
            onSelect={() => dock.toggleSide("right")}
            testId="toggle-right-sidebar"
          >
            <span className="inline-flex items-center gap-2">
              <PanelRight aria-hidden className="size-4 text-text-muted" /> Right sidebar
            </span>
          </Item>
          <DropdownMenu.Separator className={menuSeparatorClass} />
          <DropdownMenu.Label className="px-3 py-1.5 text-xs font-medium text-text-muted">
            Panels
          </DropdownMenu.Label>
          {PANEL_IDS.map((id) => {
            const open = sideOf(dock.state, id) !== null;
            return (
              <Item
                key={id}
                checked={open}
                testId={`panels-toggle-${id}`}
                onSelect={() => {
                  if (open) dock.update((s) => closePanel(s, id));
                  else dock.reveal(id);
                }}
              >
                {PANEL_TITLE[id]}
              </Item>
            );
          })}
          <DropdownMenu.Separator className={menuSeparatorClass} />
          <Item icon={<RotateCcw />} onSelect={dock.reset} testId="panels-reset">
            Reset the panels
          </Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

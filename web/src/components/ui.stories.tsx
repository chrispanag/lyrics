import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";

import { BUTTON_SIZES, BUTTON_VARIANTS } from "./buttonStyles";
import { Button, Chip, EmptyState, ErrorMessage, Notice, Spinner } from "./ui";

const meta = {
  // Button is the component with controls; the rest are shown together as the
  // vocabulary a screen is built from.
  title: "Primitives",
  component: Button,
  args: { children: "Save", onClick: fn() },
  // Listed explicitly: react-docgen cannot resolve a type imported from
  // another module, so it would infer no options at all.
  argTypes: {
    variant: { control: "inline-radio", options: BUTTON_VARIANTS },
    size: { control: "inline-radio", options: BUTTON_SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {BUTTON_VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

/** Busy means unclickable too, or a double tap submits twice. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "Save" });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip>Ρεμπέτικο</Chip>
      <Chip active>Active</Chip>
      <Chip onRemove={fn()}>Removable</Chip>
    </div>
  ),
};

export const Messages: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <Notice>Check your inbox for a code.</Notice>
      <ErrorMessage>We could not save the song.</ErrorMessage>
      <EmptyState title="No songs yet" description="Songs you save will appear here." />
      <Spinner />
    </div>
  ),
};

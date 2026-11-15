import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";

import { Button, Chip, EmptyState, ErrorMessage, Notice, Spinner } from "./ui";

const meta = {
  // Button is the component with controls; the rest are shown together as the
  // vocabulary a screen is built from.
  title: "Primitives",
  component: Button,
  args: { children: "Save", onClick: fn() },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="danger">
        Delete
      </Button>
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

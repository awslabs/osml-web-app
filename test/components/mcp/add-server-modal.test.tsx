// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AddServerModal component.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddServerModal } from "@/components/mcp/add-server-modal";
import { McpServerConfig } from "@/hooks/use-mcp";

type OnAddArgs = [server: McpServerConfig, customToken?: string];

describe("AddServerModal", () => {
  it("should render modal header when open", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
  });

  it("should render form inputs", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByLabelText(/Server Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Server URL/i)).toBeInTheDocument();
  });

  it("should render Cancel and Add Server buttons", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add server/i })
    ).toBeInTheDocument();
  });

  it("should disable Add Server button when fields empty", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });

  it("should not render when closed", () => {
    const { container } = render(
      <AddServerModal isOpen={false} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for form submission and reset (lines 31-57)
// ---------------------------------------------------------------------------

describe("AddServerModal - form interactions", () => {
  it("should render description textarea", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
  });

  it("should call onClose when Cancel clicked", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(
      <AddServerModal isOpen={true} onClose={onClose} onAdd={jest.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("should have Add Server button disabled initially", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });
});

describe("AddServerModal - authentication", () => {
  const setup = () => {
    const onAdd = jest.fn<void, OnAddArgs>();
    render(<AddServerModal isOpen={true} onAdd={onAdd} onClose={jest.fn()} />);
    return { onAdd, user: userEvent.setup() };
  };

  const fillRequired = () => {
    fireEvent.change(screen.getByLabelText(/Server Name/i), {
      target: { value: "Test" }
    });
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://geo.amazonaws.com/mcp" }
    });
  };

  it("defaults to authMode 'none'", () => {
    setup();
    expect(screen.getByRole("radio", { name: /^None$/ })).toBeChecked();
  });

  it("shows the session-token warning only when 'session' is selected", async () => {
    const { user } = setup();
    expect(
      screen.queryByText(/Authentication token will be sent/i)
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("radio", { name: /Use web app session token/i })
    );
    expect(
      screen.getByText(/Authentication token will be sent/i)
    ).toBeInTheDocument();
  });

  it("shows the custom-token field and warning only when 'custom' is selected", async () => {
    const { user } = setup();
    expect(
      screen.queryByPlaceholderText(
        /Paste the token issued by this MCP server/i
      )
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Custom token/i }));
    expect(
      screen.getByText(/Token stored in this browser/i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Paste the token issued by this MCP server/i)
    ).toBeInTheDocument();
  });

  it("renders the visibility toggle button when authMode is custom", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /Custom token/i }));
    const input = screen.getByPlaceholderText(
      /Paste the token issued by this MCP server/i
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByLabelText(/Show token/i)).toBeInTheDocument();
  });

  it("disables submit when authMode='custom' but token is empty", async () => {
    const { user } = setup();
    fillRequired();
    await user.click(screen.getByRole("radio", { name: /Custom token/i }));
    expect(
      screen.getByRole("button", { hidden: true, name: /add server/i })
    ).toBeDisabled();
  });

  it("calls onAdd with the session authMode and no token", async () => {
    const { user, onAdd } = setup();
    fillRequired();
    await user.click(
      screen.getByRole("radio", { name: /Use web app session token/i })
    );
    await user.click(
      screen.getByRole("button", { hidden: true, name: /add server/i })
    );
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [server, token] = onAdd.mock.calls[0];
    expect(server.authMode).toBe("session");
    expect(server.url).toBe("https://geo.amazonaws.com/mcp");
    expect(token).toBeUndefined();
  });

  it("calls onAdd with the custom authMode and the entered token", async () => {
    const { user, onAdd } = setup();
    fillRequired();
    await user.click(screen.getByRole("radio", { name: /Custom token/i }));
    fireEvent.change(
      screen.getByPlaceholderText(/Paste the token issued by this MCP server/i),
      { target: { value: "secret-token" } }
    );
    await user.click(screen.getByRole("button", { name: /add server/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [server, token] = onAdd.mock.calls[0];
    expect(server.authMode).toBe("custom");
    expect(token).toBe("secret-token");
  });
});

describe("AddServerModal - URL validation", () => {
  const setup = () => {
    render(
      <AddServerModal isOpen={true} onAdd={jest.fn()} onClose={jest.fn()} />
    );
    fireEvent.change(screen.getByLabelText(/Server Name/i), {
      target: { value: "Test" }
    });
  };

  const setUrl = (url: string) => {
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: url }
    });
  };

  it("blocks submit for a URL outside the allowlist", () => {
    setup();
    setUrl("https://evil.example.com/mcp");
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });

  it("blocks submit for plaintext http to a non-localhost host", () => {
    setup();
    setUrl("http://geo.amazonaws.com/mcp");
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });

  it("permits http://localhost", () => {
    setup();
    setUrl("http://localhost:3001/mcp");
    expect(screen.getByRole("button", { name: /add server/i })).toBeEnabled();
  });
});

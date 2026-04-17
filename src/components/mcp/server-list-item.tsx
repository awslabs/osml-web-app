// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CheckCircleIcon,
  InformationCircleIcon,
  TrashIcon,
  XCircleIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import { Tooltip } from "@heroui/tooltip";

import { McpServerConfig } from "@/hooks/use-mcp";

interface ConnectionState {
  status: "connected" | "connecting" | "disconnected" | "error";
  error?: string;
  lastConnected?: string;
}

interface ServerListItemProps {
  server: McpServerConfig;
  isActive: boolean;
  connectionState: ConnectionState;
  onToggleActive: (serverId: string) => void;
  onRemove: (serverId: string) => void;
}

export const ServerListItem = ({
  server,
  isActive,
  connectionState,
  onToggleActive,
  onRemove
}: ServerListItemProps) => {
  return (
    <div className="p-3 bg-default-50 rounded-lg border border-default-200">
      {/* Header row with switch, name, and status icon */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Switch
            aria-label={`Toggle ${server.name} active`}
            isSelected={isActive}
            size="sm"
            onValueChange={() => onToggleActive(server.id)}
          />
          <span className="font-medium text-sm truncate">{server.name}</span>
        </div>

        {/* Status icon */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {connectionState.status === "connected" && (
            <Tooltip content="Connected" placement="top">
              <CheckCircleIcon className="w-5 h-5 text-success" />
            </Tooltip>
          )}
          {connectionState.status === "connecting" && (
            <Tooltip content="Connecting..." placement="top">
              <Spinner size="sm" />
            </Tooltip>
          )}
          {connectionState.status === "error" && (
            <Tooltip content="Connection error" placement="top">
              <XCircleIcon className="w-5 h-5 text-danger" />
            </Tooltip>
          )}
          {connectionState.status === "disconnected" && (
            <Tooltip content="Disconnected" placement="top">
              <div className="w-5 h-5 rounded-full border-2 border-default-300 bg-default-100" />
            </Tooltip>
          )}
        </div>
      </div>

      {/* URL and description */}
      <div className="text-xs text-default-500 mb-2">
        <div className="flex items-center gap-1">
          <div className="truncate flex-1" title={server.url}>
            {server.url}
          </div>
          {server.description && (
            <Tooltip showArrow content={server.description} placement="top">
              <Button
                isIconOnly
                className="min-w-4 w-4 h-4 text-default-400"
                size="sm"
                variant="light"
              >
                <InformationCircleIcon className="h-3 w-3" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Bottom row with last connected time and delete button */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          {connectionState.lastConnected && (
            <span className="text-xs text-default-400">
              Last connected:{" "}
              {new Date(connectionState.lastConnected).toLocaleTimeString()}
            </span>
          )}
        </div>

        <Button
          isIconOnly
          aria-label={`Remove ${server.name}`}
          className="ml-2"
          color="danger"
          size="sm"
          variant="light"
          onPress={() => onRemove(server.id)}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Error message */}
      {connectionState.error && (
        <div className="mt-2 p-2 bg-danger-50 border border-danger-200 rounded text-xs text-danger-600">
          {connectionState.error}
        </div>
      )}
    </div>
  );
};

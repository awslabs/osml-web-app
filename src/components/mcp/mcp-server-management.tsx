// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Switch } from "@heroui/switch";
import { Tooltip } from "@heroui/tooltip";
import React, { useCallback } from "react";

import { McpPreferences, McpServerConfig } from "@/hooks/use-mcp";
import { useAppSelector } from "@/store/hooks";
import {
  selectMcpTools,
  selectMcpToolToServerMap
} from "@/store/slices/mcp-slice";

interface McpServerManagementProps {
  servers: McpServerConfig[];
  preferences: McpPreferences;
  onUpdateServers: (servers: McpServerConfig[]) => void;
  onUpdatePreferences: (preferences: McpPreferences) => void;
  onAddServer: () => void;
}

export const McpServerManagement: React.FC<McpServerManagementProps> = ({
  servers,
  preferences,
  onUpdateServers,
  onUpdatePreferences,
  onAddServer
}) => {
  const allTools = useAppSelector(selectMcpTools);
  const toolToServerMap = useAppSelector(selectMcpToolToServerMap);

  const getServerTools = useCallback(
    (serverName: string) => {
      return allTools.filter(
        (tool) => toolToServerMap[tool.name] === serverName
      );
    },
    [allTools, toolToServerMap]
  );

  const handleDeleteServer = useCallback(
    (serverId: string) => {
      const updatedServers = servers.filter((s) => s.id !== serverId);

      onUpdateServers(updatedServers);

      // Remove from preferences
      const updatedEnabledServers = preferences.enabledServers.filter(
        (s) => s.id !== serverId
      );

      onUpdatePreferences({
        ...preferences,
        enabledServers: updatedEnabledServers
      });
    },
    [servers, preferences, onUpdateServers, onUpdatePreferences]
  );

  const handleToggleServer = useCallback(
    (serverId: string, enabled: boolean) => {
      const server = servers.find((s) => s.id === serverId);

      if (!server) return;

      const updatedServer = { ...server, enabled };
      const updatedServers = servers.map((s) =>
        s.id === serverId ? updatedServer : s
      );

      onUpdateServers(updatedServers);

      if (enabled) {
        // Add to enabled servers if not already there
        if (!preferences.enabledServers.find((s) => s.id === serverId)) {
          const updatedEnabledServers = [
            ...preferences.enabledServers,
            updatedServer
          ];

          onUpdatePreferences({
            ...preferences,
            enabledServers: updatedEnabledServers
          });
        }
      } else {
        // Remove from enabled servers
        const updatedEnabledServers = preferences.enabledServers.filter(
          (s) => s.id !== serverId
        );

        onUpdatePreferences({
          ...preferences,
          enabledServers: updatedEnabledServers
        });
      }
    },
    [servers, preferences, onUpdateServers, onUpdatePreferences]
  );

  // Simple server list display only
  return (
    <>
      {servers.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-default-500 mb-4">No MCP servers configured</p>
          <p className="text-xs text-default-400">
            Add servers using the button below to enable geospatial tools
          </p>
          <Button className="mt-4" color="primary" onPress={onAddServer}>
            Add MCP Server
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const isEnabled = preferences.enabledServers.some(
              (s) => s.id === server.id
            );
            const toolCount = server.toolCount || 0;
            const realTimeState =
              server.liveConnectionState || server.connectionStatus;

            const getStatusInfo = (): {
              color: "default" | "success" | "warning" | "danger";
              text: string;
            } => {
              if (!isEnabled) {
                return { color: "default", text: "Disabled" };
              }

              if (realTimeState === "ready") {
                return { color: "success", text: "Connected" };
              } else if (realTimeState && realTimeState.endsWith("ing")) {
                return { color: "warning", text: "Connecting" };
              } else if (
                realTimeState === "failed" ||
                server.connectionStatus === "failed"
              ) {
                return { color: "danger", text: "Failed" };
              } else {
                return { color: "warning", text: realTimeState || "Unknown" };
              }
            };

            const statusInfo = getStatusInfo();

            return (
              <div
                key={server.id}
                className="flex items-center justify-between p-3 border border-default-200 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Tooltip
                    content={
                      isEnabled
                        ? "Disable server and tools"
                        : "Enable server and tools"
                    }
                    placement="left"
                  >
                    <Switch
                      aria-label={`Toggle server ${server.name}`}
                      isSelected={isEnabled}
                      size="sm"
                      onValueChange={(enabled) =>
                        handleToggleServer(server.id, enabled)
                      }
                    />
                  </Tooltip>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{server.name}</p>
                    {server.description && (
                      <p className="text-xs text-default-500 mb-1">
                        {server.description}
                      </p>
                    )}
                    <code className="text-xs text-default-400 bg-default-100 px-2 py-1 rounded block">
                      {server.url}
                    </code>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {toolCount > 0 && (
                      <Tooltip
                        showArrow
                        classNames={{
                          content:
                            "max-w-md bg-default-100 border border-default-200"
                        }}
                        content={
                          <div className="p-3">
                            <p className="text-xs font-medium mb-2">
                              Available Tools ({toolCount}):
                            </p>
                            <div className="space-y-1">
                              {getServerTools(server.name).length > 0 ? (
                                <div className="grid grid-cols-1 gap-1">
                                  {getServerTools(server.name).map(
                                    (tool, index) => (
                                      <div
                                        key={index}
                                        className="flex items-center gap-2"
                                      >
                                        <div className="w-1 h-1 rounded-full bg-primary-400" />
                                        <span className="text-xs text-default-700 font-medium">
                                          {tool.name}
                                        </span>
                                      </div>
                                    )
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-default-600">
                                  {toolCount} tools available. Connect to server
                                  to see tool names.
                                </p>
                              )}
                            </div>
                          </div>
                        }
                        placement="bottom"
                      >
                        <Chip
                          className="text-xs cursor-pointer hover:bg-primary-100 transition-colors"
                          color="primary"
                          size="sm"
                          variant="flat"
                        >
                          {toolCount} tools
                        </Chip>
                      </Tooltip>
                    )}
                    <Chip color={statusInfo.color} size="sm" variant="flat">
                      {statusInfo.text}
                    </Chip>
                  </div>
                  <Tooltip color="danger" content="Delete server">
                    <Button
                      isIconOnly
                      aria-label={`Delete server ${server.name}`}
                      color="danger"
                      size="sm"
                      variant="light"
                      onPress={() => handleDeleteServer(server.id)}
                    >
                      <TrashIcon className="w-3 h-3" />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            );
          })}

          <div className="mt-4 text-center">
            <Button color="primary" variant="flat" onPress={onAddServer}>
              Add MCP Server
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

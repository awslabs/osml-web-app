// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CheckCircleIcon,
  Cog6ToothIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  ServerIcon,
  XCircleIcon
} from "@heroicons/react/24/outline";
import { Accordion, AccordionItem } from "@heroui/accordion";
import { Button } from "@heroui/button";
import { useDisclosure } from "@heroui/modal";
import { Tooltip } from "@heroui/tooltip";
import { useSelector } from "react-redux";

import { ModelSelector } from "@/components/chat/model-selector";
import { McpServerManagementModal } from "@/components/modals/mcp-server-management-modal";
import {
  selectConnectedServersCount,
  selectMcpServers,
  selectTotalToolCount
} from "@/store/slices/mcp-slice";
import { RootState } from "@/store/store";

export const GeoAgentSidebar = () => {
  const { selectedModel } = useSelector(
    (state: RootState) => state.bedrockModel
  );
  const mcpServers = useSelector(selectMcpServers);
  const totalToolCount = useSelector(selectTotalToolCount);
  const connectedCount = useSelector(selectConnectedServersCount);

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const enabledServers = mcpServers.filter((server) => server.enabled);

  return (
    <>
      <Accordion defaultExpandedKeys={["1", "2"]} selectionMode="multiple">
        <AccordionItem key="1" aria-label="AI Model" title="AI Model">
          <div className="space-y-3">
            <ModelSelector
              isConnected={true}
              size="sm"
              onModelChange={() => {
                void 0;
              }}
            />

            {/* Model Details Card */}
            <div className="p-3 bg-default-100 rounded-lg">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span
                    className={`font-medium ${selectedModel ? "text-success" : "text-warning"}`}
                  >
                    {selectedModel ? "Connected" : "No Model Selected"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Provider:</span>
                  <span className="font-medium">
                    {selectedModel
                      ? `${selectedModel.providerName} via AWS Bedrock`
                      : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Model ID:</span>
                  <span className="font-medium text-xs">
                    {selectedModel?.modelId || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Streaming:</span>
                  <span
                    className={`font-medium ${selectedModel?.supportsStreaming ? "text-success" : "text-warning"}`}
                  >
                    {selectedModel?.supportsStreaming ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Input Types:</span>
                  <span className="font-medium">
                    {selectedModel?.inputModalities.join(", ") || "N/A"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </AccordionItem>
        <AccordionItem
          key="2"
          aria-label="MCP Servers"
          title={
            <div className="flex items-center gap-2">
              <ServerIcon className="w-4 h-4" />
              <span>MCP Servers</span>
              <Tooltip
                showArrow
                classNames={{
                  content: "bg-default-100 border border-default-200"
                }}
                content={
                  <div className="max-w-xs p-2">
                    <div className="text-sm space-y-2">
                      <p className="font-medium">MCP Server Integration</p>
                      <p>
                        Configure and manage Model Context Protocol servers that
                        provide specialized tools for geospatial analysis.
                      </p>
                      <div className="space-y-1">
                        <p className="font-medium">Available tools include:</p>
                        <ul className="list-disc list-inside text-xs space-y-1 ml-2">
                          <li>Geometry buffering and translation</li>
                          <li>Dataset clustering and correlation</li>
                          <li>Spatial filtering and sampling</li>
                          <li>Dataset summarization</li>
                          <li>Multi-format data processing</li>
                        </ul>
                      </div>
                      <p className="text-xs text-primary-600">
                        <strong>Tip:</strong> Enable servers to make their tools
                        available to the AI assistant during conversations.
                      </p>
                    </div>
                  </div>
                }
                placement="bottom"
              >
                <QuestionMarkCircleIcon className="h-4 w-4 text-default-400" />
              </Tooltip>
            </div>
          }
        >
          <div className="space-y-3">
            {/* Status Summary */}
            <div className="p-3 bg-default-100 rounded-lg">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>Total Servers:</span>
                  <span className="font-medium">{mcpServers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Enabled:</span>
                  <span className="font-medium text-success">
                    {enabledServers.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Connected:</span>
                  <span
                    className={`font-medium ${connectedCount > 0 ? "text-success" : "text-danger"}`}
                  >
                    {connectedCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Available Tools:</span>
                  <span className="font-medium text-primary">
                    {totalToolCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Server List */}
            {mcpServers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-default-700">
                  Configured Servers
                </h4>
                <div className="space-y-1">
                  {mcpServers.map((server) => {
                    const isConnected = server.liveConnectionState === "ready";
                    const toolCount = server.toolCount || 0;

                    return (
                      <div
                        key={server.id}
                        className="flex items-center justify-between p-2 bg-default-50 rounded-md"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">{server.name}</p>
                          {server.enabled && (
                            <p
                              className={`text-xs ${isConnected ? "text-success-600" : "text-default-400"}`}
                            >
                              {toolCount} tools available
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {server.enabled ? (
                            <Tooltip
                              content={
                                isConnected
                                  ? `Connected - ${toolCount} tools`
                                  : "No tools available"
                              }
                            >
                              {isConnected ? (
                                <CheckCircleIcon className="w-4 h-4 text-success" />
                              ) : (
                                <XCircleIcon className="w-4 h-4 text-danger" />
                              )}
                            </Tooltip>
                          ) : (
                            <Tooltip content="Server disabled">
                              <div className="w-2 h-2 rounded-full bg-default-300" />
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Management Button */}
            <div className="pt-2 border-t">
              <Button
                className="w-full"
                color="primary"
                startContent={<Cog6ToothIcon className="w-4 h-4" />}
                variant="light"
                onPress={onOpen}
              >
                Manage Servers
              </Button>
            </div>

            {/* Empty State */}
            {mcpServers.length === 0 && (
              <div className="text-center py-6 text-default-500">
                <p className="text-sm mb-3">No MCP servers configured</p>
                <p className="text-xs mb-4 text-default-400">
                  Add the OSML Geo Agent server to enable geospatial tools
                </p>
                <Button
                  color="primary"
                  size="sm"
                  startContent={<PlusIcon className="h-4 w-4" />}
                  variant="flat"
                  onPress={onOpen}
                >
                  Add Geo Agent Server
                </Button>
              </div>
            )}
          </div>
        </AccordionItem>
      </Accordion>

      {/* MCP Server Management Modal */}
      <McpServerManagementModal isOpen={isOpen} onOpenChange={onOpenChange} />
    </>
  );
};

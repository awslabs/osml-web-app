// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";

interface ToolLimitWarningModalProps {
  /** The consecutive tool-call limit that was reached. */
  limit: number;
  /** Stop processing and reset the circuit breaker. */
  onStop: () => void;
  /** Continue running the deferred tool chain. */
  onContinue: () => void;
}

/**
 * Circuit-breaker modal shown when the agent makes too many consecutive tool
 * calls, giving the user a choice to continue or stop. Presentational only —
 * state lives in {@link useAutoToolChain}.
 */
export const ToolLimitWarningModal = ({
  limit,
  onStop,
  onContinue
}: ToolLimitWarningModalProps) => (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
    <Card className="max-w-md w-full">
      <CardHeader>
        <h3 className="text-lg font-semibold text-warning">
          Tool Execution Limit Reached
        </h3>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-default-600">
          The AI has made {limit} consecutive tool calls. This might indicate an
          infinite loop. Do you want to continue processing or stop here?
        </p>
        <div className="flex gap-2 justify-end">
          <Button color="default" variant="flat" onPress={onStop}>
            Stop
          </Button>
          <Button color="primary" onPress={onContinue}>
            Continue
          </Button>
        </div>
      </CardBody>
    </Card>
  </div>
);

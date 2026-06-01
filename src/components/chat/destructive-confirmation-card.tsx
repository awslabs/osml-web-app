// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon
} from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@heroui/card";

export type DestructiveConfirmationStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "failed";

interface DestructiveConfirmationCardProps {
  title: string;
  message: string;
  warning?: string;
  status: DestructiveConfirmationStatus;
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DestructiveConfirmationCard = ({
  title,
  message,
  warning,
  status,
  errorMessage,
  onConfirm,
  onCancel
}: DestructiveConfirmationCardProps) => {
  if (status === "pending") {
    return (
      <Card className="border border-danger-200 bg-danger-50">
        <CardHeader className="flex items-center gap-2">
          <ExclamationTriangleIcon
            aria-hidden="true"
            className="w-5 h-5 text-danger"
          />
          <span className="font-semibold text-danger">{title}</span>
        </CardHeader>
        <CardBody className="gap-2 text-sm">
          <p>{message}</p>
          {warning && (
            <p className="text-xs text-danger-700 font-medium">{warning}</p>
          )}
        </CardBody>
        <CardFooter className="justify-end gap-2">
          <Button size="sm" variant="flat" onPress={onCancel}>
            Cancel
          </Button>
          <Button color="danger" size="sm" onPress={onConfirm}>
            Delete
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border border-default-200">
      <CardBody className="flex-row items-center gap-2 text-sm">
        {status === "completed" && (
          <>
            <CheckCircleIcon className="w-5 h-5 text-success" />
            <span>{title.replace(/\?$/, "")} — Deleted.</span>
          </>
        )}
        {status === "cancelled" && (
          <>
            <XCircleIcon className="w-5 h-5 text-default-500" />
            <span>{title.replace(/\?$/, "")} — Cancelled by user.</span>
          </>
        )}
        {status === "failed" && (
          <>
            <ExclamationTriangleIcon className="w-5 h-5 text-danger" />
            <div className="flex-1">
              <div>{title.replace(/\?$/, "")} — Failed.</div>
              {errorMessage && (
                <div className="text-xs text-danger-700 mt-1">
                  {errorMessage}
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
};

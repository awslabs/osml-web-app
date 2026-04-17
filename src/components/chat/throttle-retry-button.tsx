// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { ArrowPathIcon, ClockIcon } from "@heroicons/react/16/solid";
import { Button } from "@heroui/button";
import { CircularProgress } from "@heroui/progress";
import { useEffect, useState } from "react";

interface ThrottleRetryButtonProps {
  retryAfterSeconds: number;
  onRetry: () => void;
  isPermanent?: boolean;
}

export const ThrottleRetryButton = ({
  retryAfterSeconds,
  onRetry,
  isPermanent = false
}: ThrottleRetryButtonProps) => {
  const [secondsRemaining, setSecondsRemaining] = useState(retryAfterSeconds);
  const [canRetry, setCanRetry] = useState(retryAfterSeconds === 0);

  useEffect(() => {
    if (isPermanent || retryAfterSeconds === 0) {
      setCanRetry(true);

      return;
    }

    setSecondsRemaining(retryAfterSeconds);

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setCanRetry(true);

          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [retryAfterSeconds, isPermanent]);

  if (isPermanent) {
    return (
      <div className="flex items-center gap-2 text-warning">
        <ClockIcon className="w-4 h-4" />
        <span className="text-xs">
          Request too large - modify request to proceed
        </span>
      </div>
    );
  }

  const progressValue =
    retryAfterSeconds > 0
      ? ((retryAfterSeconds - secondsRemaining) / retryAfterSeconds) * 100
      : 100;

  return (
    <Button
      className={
        canRetry ? "opacity-100 min-w-12 ml-2" : "opacity-60 min-w-12 ml-2"
      }
      color="warning"
      isDisabled={!canRetry}
      isIconOnly={!canRetry} // Icon-only during countdown to save space
      size="sm"
      startContent={
        !canRetry ? (
          <CircularProgress
            aria-label="Retry countdown"
            classNames={{
              svg: "w-6 h-6",
              value: "text-[10px] font-bold"
            }}
            color="warning"
            showValueLabel={true}
            size="lg"
            value={progressValue}
            valueLabel={`${secondsRemaining}s`}
          />
        ) : (
          <ArrowPathIcon className="w-3 h-3" />
        )
      }
      variant="flat"
      onPress={onRetry}
    >
      {canRetry ? "Retry" : ""}
    </Button>
  );
};

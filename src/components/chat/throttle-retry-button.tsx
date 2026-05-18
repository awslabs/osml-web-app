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

  // Sync the countdown to the latest retryAfterSeconds prop during render
  // (not in an effect), per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [retryAfterSecondsRef, setRetryAfterSecondsRef] =
    useState(retryAfterSeconds);
  if (retryAfterSecondsRef !== retryAfterSeconds) {
    setRetryAfterSecondsRef(retryAfterSeconds);
    setSecondsRemaining(retryAfterSeconds);
  }

  // Derived value: avoids the previous setState-in-effect pattern of
  // mirroring the countdown finish into a separate `canRetry` flag.
  const canRetry =
    isPermanent || retryAfterSeconds === 0 || secondsRemaining === 0;

  useEffect(() => {
    if (isPermanent || retryAfterSeconds === 0) return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
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

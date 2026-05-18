// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import { ClockIcon } from "@heroicons/react/24/outline";
import { Chip } from "@heroui/chip";
import { useEffect, useState } from "react";

interface ThrottleCountdownProps {
  retryAt: number; // Unix timestamp when retry is allowed
  onExpired?: () => void;
}

export const ThrottleCountdown = ({
  retryAt,
  onExpired
}: ThrottleCountdownProps) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const updateTimeRemaining = () => {
      const now = Date.now();
      const remaining = Math.max(0, retryAt - now);

      setTimeRemaining(remaining);

      if (remaining === 0 && onExpired) {
        onExpired();
      }
    };

    // Initial update
    updateTimeRemaining();

    // Update every second
    const interval = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [retryAt, onExpired]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    return `${seconds}s`;
  };

  if (timeRemaining === 0) {
    return null;
  }

  return (
    <Chip
      color="warning"
      size="sm"
      startContent={<ClockIcon className="w-4 h-4" />}
      variant="flat"
    >
      Retry in {formatTime(timeRemaining)}
    </Chip>
  );
};

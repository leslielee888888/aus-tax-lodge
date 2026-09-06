"use client";

import { useEffect } from "react";

import { ErrorScreen } from "../../../components/ErrorScreen";

export default function ReturnError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorScreen
      reset={reset}
      description="This step hit an unexpected error. Every figure you've confirmed is saved — try again, or go back to your returns."
    />
  );
}

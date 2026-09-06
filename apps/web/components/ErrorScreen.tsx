"use client";

import Link from "next/link";

import { buttonClassName, Button } from "./Button";
import { AlertTriangleIcon } from "./icons";

/**
 * Shared body for the App Router `error.tsx` boundaries (WCAG 2.2 — every screen
 * handles the error state). Calm "something went wrong / try again", matching
 * `States.dc.html`. `error.tsx` files are Client Components; this is too.
 */
export function ErrorScreen({
  reset,
  title = "Something went wrong",
  description = "That screen hit an unexpected error. Your saved data is untouched — try again, or go back to your returns.",
  homeHref = "/",
  homeLabel = "Back to your returns",
}: {
  reset: () => void;
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <span
        className="mb-4 flex size-11 items-center justify-center rounded-card bg-danger-soft text-danger"
        aria-hidden="true"
      >
        <AlertTriangleIcon className="size-5" />
      </span>
      <h1 className="font-serif text-xl font-medium">{title}</h1>
      <p className="mt-2 text-xs text-muted">{description}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link href={homeHref} className={buttonClassName({ variant: "ghost" })}>
          {homeLabel}
        </Link>
      </div>
    </main>
  );
}

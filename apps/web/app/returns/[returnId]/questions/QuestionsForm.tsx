"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";

import { buttonClassName, Button } from "../../../../components/Button";
import { Card } from "../../../../components/Card";
import { AlertTriangleIcon, ArrowRightIcon } from "../../../../components/icons";
import { Input } from "../../../../components/Input";
import type {
  DisagreementResolution,
  JointAccountRowInfo,
  PrivateCoverChoice,
  QuestionsFormValues,
  YesNo,
} from "../../../../lib/questions/form";
import { saveQuestions, type QuestionsFormState } from "./actions";

export interface QuestionsFormProps {
  readonly returnId: string;
  readonly expectedRevision: number;
  readonly initialValues: QuestionsFormValues;
  readonly jointAccounts: readonly JointAccountRowInfo[];
  readonly rentalPresent: boolean;
  readonly rentalAddressLabel: string;
  /** What T15's details step says — used to detect a residency disagreement client-side. */
  readonly detailsResidentFullYear: boolean;
  /** What T15's details step says — used to detect a study-loan disagreement client-side. */
  readonly detailsHoldsStudyLoan: boolean;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function optionClassName(selected: boolean): string {
  return [
    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors",
    "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
    selected
      ? "border-accent bg-surface-2 text-text"
      : "border-border bg-surface text-muted hover:bg-surface-2",
  ].join(" ");
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "size-3.5 shrink-0 rounded-full border-[1.5px]",
        selected ? "border-accent bg-accent" : "border-border",
      ].join(" ")}
    />
  );
}

function YesNoFieldset({
  legend,
  hint,
  name,
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
  disabled,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  name: string;
  value: YesNo;
  onChange: (next: YesNo) => void;
  yesLabel?: string;
  noLabel?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" disabled={disabled}>
      <legend className="p-0 text-left font-medium text-text">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {(["yes", "no"] as const).map((option) => {
          const selected = value === option;
          return (
            <label key={option} className={optionClassName(selected)}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <RadioDot selected={selected} />
              {option === "yes" ? yesLabel : noLabel}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** The side-by-side "which is right?" pick for a residency / study-loan disagreement (PRD FR-6, in the spirit of T12/FR-21). */
function DisagreementPanel({
  name,
  message,
  detailsLabel,
  answerLabel,
  resolution,
  onResolve,
  error,
}: {
  name: string;
  message: string;
  detailsLabel: string;
  answerLabel: string;
  resolution: DisagreementResolution | null;
  onResolve: (next: DisagreementResolution) => void;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset className="m-0 flex flex-col gap-3 rounded-lg border-0 bg-danger-soft px-4 py-3">
      <legend className="flex items-center gap-1.5 p-0 text-[12.5px] font-medium text-danger">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        {message}
      </legend>
      <div className="flex flex-wrap gap-2" aria-describedby={error ? errorId : undefined}>
        {(
          [
            ["keep-details", detailsLabel],
            ["use-answer", answerLabel],
          ] as const
        ).map(([option, label]) => {
          const selected = resolution === option;
          return (
            <label key={option} className={optionClassName(selected)}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onResolve(option)}
                className="sr-only"
              />
              <RadioDot selected={selected} />
              {label}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/**
 * The T18 gap questionnaire (PRD FR-6, §7 step 6) — one card, structured
 * single-choice / short-answer questions (not free-form chat), matching the
 * `Questions.dc.html` design. A single server action collects every answer
 * on submit; residency and study loan are cross-checks against T15's details
 * step, so a disagreement blocks that one question until the user says which
 * side is right (see `lib/questions/form.ts`).
 */
export function QuestionsForm({
  returnId,
  expectedRevision,
  initialValues,
  jointAccounts,
  rentalPresent,
  rentalAddressLabel,
  detailsResidentFullYear,
  detailsHoldsStudyLoan,
}: QuestionsFormProps) {
  const boundSave = saveQuestions.bind(null, returnId, expectedRevision);
  const [state, formAction, pending] = useActionState<QuestionsFormState, FormData>(boundSave, {
    values: initialValues,
    errors: {},
  });

  const [residency, setResidency] = useState<YesNo>(state.values.residencyFullYear);
  const [residencyResolution, setResidencyResolution] = useState<DisagreementResolution | null>(
    state.values.residencyDisagreement ?? null,
  );
  const [studyLoan, setStudyLoan] = useState<YesNo>(state.values.studyLoanHeld);
  const [studyLoanResolution, setStudyLoanResolution] = useState<DisagreementResolution | null>(
    state.values.studyLoanDisagreement ?? null,
  );
  const [privateCoverDates, setPrivateCoverDates] = useState<PrivateCoverChoice>(
    state.values.privateCoverDates,
  );
  const [privateCoverDays, setPrivateCoverDays] = useState(state.values.privateCoverDays);
  const [wfhDoubleClaimed, setWfhDoubleClaimed] = useState<YesNo>(state.values.wfhDoubleClaimed);
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(jointAccounts.map((row) => [row.accountId, ""])),
  );
  const [rentalAllYear, setRentalAllYear] = useState<YesNo>(
    state.values.rentalSoleOwnershipAllYear,
  );
  const [rentalBoughtOrSold, setRentalBoughtOrSold] = useState<YesNo>(
    state.values.rentalBoughtOrSold,
  );

  const privateCoverId = useId();

  const residencyDisagreementPresent = residency !== (detailsResidentFullYear ? "yes" : "no");
  const studyLoanDisagreementPresent = studyLoan !== (detailsHoldsStudyLoan ? "yes" : "no");

  const jointErrors = state.errors.jointAccounts ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex flex-col gap-3 px-5 py-4">
            <YesNoFieldset
              legend="Were you an Australian resident for tax purposes for the whole year?"
              name="residencyFullYear"
              value={residency}
              onChange={(next) => {
                setResidency(next);
                setResidencyResolution(null);
              }}
              noLabel="No / part of the year"
              hint={
                residency === "no" ? (
                  <span className="text-warn">
                    Non-resident and part-year returns are out of scope for this tool.
                  </span>
                ) : undefined
              }
            />
            <div aria-live="polite">
              {residencyDisagreementPresent ? (
                <DisagreementPanel
                  name="residencyDisagreement"
                  message="This disagrees with what you entered on the details step. Which is right?"
                  detailsLabel={`Your details said: ${detailsResidentFullYear ? "resident all year" : "not a resident all year"}`}
                  answerLabel={`This answer: ${residency === "yes" ? "resident all year" : "not a resident all year"}`}
                  resolution={residencyResolution}
                  onResolve={setResidencyResolution}
                  error={state.errors.residencyDisagreement}
                />
              ) : null}
            </div>
          </div>

          {jointAccounts.map((row) => (
            <div key={row.accountId} className="flex flex-col gap-2 px-5 py-4">
              <label htmlFor={`joint-${row.accountId}`} className="font-medium text-text">
                What share of the interest from {row.label} is yours?
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`joint-${row.accountId}`}
                  name={`jointShare.${row.accountId}`}
                  mono
                  inputMode="decimal"
                  className="max-w-[110px]"
                  value={shares[row.accountId] ?? ""}
                  onChange={(e) =>
                    setShares((prev) => ({ ...prev, [row.accountId]: e.target.value }))
                  }
                  aria-describedby={
                    jointErrors[row.accountId]
                      ? `joint-${row.accountId}-hint joint-${row.accountId}-error`
                      : `joint-${row.accountId}-hint`
                  }
                  aria-invalid={Boolean(jointErrors[row.accountId])}
                />
                <span className="text-muted">%</span>
              </div>
              <p id={`joint-${row.accountId}-hint`} className="text-[11px] text-muted">
                Joint account. We&rsquo;ll use your share of the interest.
              </p>
              {jointErrors[row.accountId] ? (
                <p
                  id={`joint-${row.accountId}-error`}
                  role="alert"
                  className="text-[11px] font-medium text-danger"
                >
                  {jointErrors[row.accountId]}
                </p>
              ) : null}
            </div>
          ))}

          <div className="flex flex-col gap-3 px-5 py-4">
            <YesNoFieldset
              legend="Did you hold a HELP or study/training support loan on 1 June 2026?"
              name="studyLoanHeld"
              value={studyLoan}
              onChange={(next) => {
                setStudyLoan(next);
                setStudyLoanResolution(null);
              }}
            />
            <div aria-live="polite">
              {studyLoanDisagreementPresent ? (
                <DisagreementPanel
                  name="studyLoanDisagreement"
                  message="This disagrees with what you entered on the details step. Which is right?"
                  detailsLabel={`Your details said: ${detailsHoldsStudyLoan ? "yes, holds a loan" : "no loan"}`}
                  answerLabel={`This answer: ${studyLoan === "yes" ? "yes, holds a loan" : "no loan"}`}
                  resolution={studyLoanResolution}
                  onResolve={setStudyLoanResolution}
                  error={state.errors.studyLoanDisagreement}
                />
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
              <legend className="p-0 text-left font-medium text-text">
                Which dates did you hold an appropriate level of private hospital cover?
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["full", "Full year"],
                    ["part", "Part of the year"],
                    ["none", "None"],
                  ] as const
                ).map(([option, label]) => {
                  const selected = privateCoverDates === option;
                  return (
                    <label key={option} className={optionClassName(selected)}>
                      <input
                        type="radio"
                        name="privateCoverDates"
                        value={option}
                        checked={selected}
                        onChange={() => setPrivateCoverDates(option)}
                        className="sr-only"
                      />
                      <RadioDot selected={selected} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {privateCoverDates !== "full" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={privateCoverId} className="text-xs font-semibold">
                  Days of private hospital cover
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={privateCoverId}
                    name="privateCoverDays"
                    mono
                    inputMode="numeric"
                    className="max-w-[110px]"
                    value={privateCoverDays}
                    onChange={(e) => setPrivateCoverDays(e.target.value)}
                    aria-invalid={Boolean(state.errors.privateCoverDays)}
                    aria-describedby={
                      state.errors.privateCoverDays ? `${privateCoverId}-error` : undefined
                    }
                  />
                  <span className="text-muted">days</span>
                </div>
                {state.errors.privateCoverDays ? (
                  <p
                    id={`${privateCoverId}-error`}
                    role="alert"
                    className="text-[11px] font-medium text-danger"
                  >
                    {state.errors.privateCoverDays}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <YesNoFieldset
              legend="Did any of your work-from-home hours also get claimed as a separate expense (phone, internet, depreciation)?"
              name="wfhDoubleClaimed"
              value={wfhDoubleClaimed}
              onChange={setWfhDoubleClaimed}
              hint="The fixed-rate method already covers those — claiming them again would overstate the deduction."
            />
          </div>

          {rentalPresent ? (
            <>
              <div className="flex flex-col gap-3 px-5 py-4">
                <YesNoFieldset
                  legend={`About ${rentalAddressLabel} — for the whole year, was it owned only by you, rented or genuinely available to rent, with no private use?`}
                  name="rentalSoleOwnershipAllYear"
                  value={rentalAllYear}
                  onChange={setRentalAllYear}
                  yesLabel="Yes to all"
                  noLabel="No / some don’t apply"
                  hint="If any of these isn’t true — co-owned, part-year, some private use, short-stay letting — this tool can’t prepare the return and you’ll be pointed to a tax agent."
                />
              </div>
              <div className="flex flex-col gap-3 px-5 py-4">
                <YesNoFieldset
                  legend={`Did you buy or sell ${rentalAddressLabel} during the year?`}
                  name="rentalBoughtOrSold"
                  value={rentalBoughtOrSold}
                  onChange={setRentalBoughtOrSold}
                  hint="A sale means a capital gain to work out, which is out of scope."
                />
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {state.formError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-soft p-3 text-xs font-medium text-danger"
        >
          {state.formError}
          {state.conflict ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Reload now? Anything you typed on this screen will be lost."))
                    window.location.reload();
                }}
                className="underline"
              >
                Reload now
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/returns/${returnId}/review`}
          className={buttonClassName({ variant: "ghost" })}
        >
          Back
        </Link>
        <Button
          type="submit"
          variant="primary"
          aria-busy={pending}
          disabled={
            pending ||
            (residencyDisagreementPresent && !residencyResolution) ||
            (studyLoanDisagreementPresent && !studyLoanResolution)
          }
        >
          {pending ? "Saving…" : "See your estimate"}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}

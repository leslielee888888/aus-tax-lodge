"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefCallback,
} from "react";

import { Badge } from "../../../../components/Badge";
import { Button, buttonClassName } from "../../../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import { Field } from "../../../../components/Field";
import { ArrowRightIcon } from "../../../../components/icons";
import { Input } from "../../../../components/Input";
import { Select } from "../../../../components/Select";
import {
  parseDetailsFormData,
  validateDetailsForm,
  type DetailsFieldErrors,
  type DetailsFormValues,
} from "../../../../lib/details/form";
import type { SpouseIncomeCandidate } from "../../../../lib/details/spouse-income-candidates";
import { digitsOnly, validateTfn } from "../../../../lib/details/validation";
import { saveDetails, type DetailsFormState } from "./actions";

export interface DetailsFormProps {
  readonly returnId: string;
  readonly expectedRevision: number;
  readonly initialValues: DetailsFormValues;
  readonly spouseIncomeCandidates: readonly SpouseIncomeCandidate[];
}

/** Order fields are checked/focused in — top to bottom, matching the layout. */
const FIELD_ORDER: readonly (keyof DetailsFormValues)[] = [
  "fullName",
  "dob",
  "line1",
  "suburb",
  "state",
  "postcode",
  "tfn",
  "bsb",
  "accountNumber",
  "accountName",
  "privateCoverDays",
  "dependentChildren",
  "spouseName",
  "spouseDob",
  "spouseIncome",
  "spouseCoverDays",
];

function describedBy(id: string, hasHint: boolean, error?: string): string | undefined {
  const ids: string[] = [];
  if (hasHint) ids.push(`${id}-hint`);
  if (error) ids.push(`${id}-error`);
  return ids.length ? ids.join(" ") : undefined;
}

/** Grouped digits with a bullet standing in for every digit but the last three. */
function maskTfn(digits: string): string {
  if (!digits) return "";
  const maskedCount = Math.max(digits.length - 3, 0);
  const combined = "•".repeat(maskedCount) + digits.slice(-3);
  return combined.match(/.{1,3}/g)?.join(" ") ?? combined;
}

function groupTfn(digits: string): string {
  return digits.match(/.{1,3}/g)?.join(" ") ?? digits;
}

export function DetailsForm({
  returnId,
  expectedRevision,
  initialValues,
  spouseIncomeCandidates,
}: DetailsFormProps) {
  const boundSave = saveDetails.bind(null, returnId, expectedRevision);
  const [state, formAction, pending] = useActionState<DetailsFormState, FormData>(boundSave, {
    values: initialValues,
    errors: {},
  });

  // Precheck errors from the client-side validation pass in handleSubmit —
  // shown immediately (and focused) without waiting on a server round trip.
  const [precheckErrors, setPrecheckErrors] = useState<DetailsFieldErrors>({});
  const errors: DetailsFieldErrors = { ...state.errors, ...precheckErrors };

  const [hasSpouse, setHasSpouse] = useState(initialValues.hasSpouse);
  const [residency, setResidency] = useState(initialValues.residency);
  const [spouseName, setSpouseName] = useState(initialValues.spouseName);

  const [tfnDigits, setTfnDigits] = useState(initialValues.tfn);
  const [tfnFocused, setTfnFocused] = useState(false);

  const fieldRefs = useRef<Partial<Record<keyof DetailsFormValues, HTMLElement | null>>>({});
  const registerRef =
    (name: keyof DetailsFormValues): RefCallback<HTMLElement> =>
    (el) => {
      fieldRefs.current[name] = el;
    };
  const focusFirstError = (errs: DetailsFieldErrors) => {
    const firstKey = FIELD_ORDER.find((key) => errs[key]);
    if (firstKey) fieldRefs.current[firstKey]?.focus();
  };

  // Focus the first invalid field whenever the server action comes back with
  // errors (client validation already handles the common case in
  // handleSubmit below; this covers a server-side disagreement too).
  useEffect(() => {
    if (Object.keys(state.errors).length > 0) focusFirstError(state.errors);
  }, [state]);

  const tfnFieldId = useId();
  const spouseIncomeId = useId();
  const line1Id = useId();
  const line2Id = useId();
  const suburbId = useId();
  const stateFieldId = useId();
  const postcodeId = useId();

  const matchingCandidate = spouseIncomeCandidates.find(
    (candidate) => candidate.name.trim().toLowerCase() === spouseName.trim().toLowerCase(),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const values = parseDetailsFormData(formData);
    const nextErrors = validateDetailsForm(values);
    setPrecheckErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      event.preventDefault();
      focusFirstError(nextErrors);
    }
  }

  function handleTfnBlur() {
    setTfnFocused(false);
    setPrecheckErrors((prev) => {
      const next = { ...prev };
      const error = validateTfn(tfnDigits);
      if (error) next.tfn = error;
      else delete next.tfn;
      return next;
    });
  }

  function copySpouseIncome() {
    if (!matchingCandidate) return;
    const input = fieldRefs.current.spouseIncome as HTMLInputElement | undefined;
    if (input) input.value = String(matchingCandidate.taxableIncome);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="tfn" value={tfnDigits} />

      <Card>
        <CardHeader>
          <CardTitle>Identity &amp; refund</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fullName" required error={errors.fullName}>
            <Input
              id="fullName"
              name="fullName"
              required
              autoComplete="name"
              defaultValue={initialValues.fullName}
              ref={registerRef("fullName")}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={describedBy("fullName", false, errors.fullName)}
            />
          </Field>

          <Field label="Date of birth" htmlFor="dob" required hint="DD/MM/YYYY" error={errors.dob}>
            <Input
              id="dob"
              name="dob"
              required
              inputMode="numeric"
              autoComplete="bday"
              placeholder="DD/MM/YYYY"
              defaultValue={initialValues.dob}
              ref={registerRef("dob")}
              aria-invalid={Boolean(errors.dob)}
              aria-describedby={describedBy("dob", true, errors.dob)}
            />
          </Field>

          <fieldset className="col-span-full m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="p-0 font-sans text-xs font-semibold">
              Postal address <span className="text-danger">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor={line1Id} className="text-xs text-muted">
                  Address line 1
                </label>
                <Input
                  id={line1Id}
                  name="line1"
                  required
                  autoComplete="address-line1"
                  defaultValue={initialValues.line1}
                  ref={registerRef("line1")}
                  aria-invalid={Boolean(errors.line1)}
                  aria-describedby={errors.line1 ? `${line1Id}-error` : undefined}
                />
                {errors.line1 ? (
                  <p
                    id={`${line1Id}-error`}
                    role="alert"
                    className="text-[11px] font-medium text-danger"
                  >
                    {errors.line1}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor={line2Id} className="text-xs text-muted">
                  Address line 2 (optional)
                </label>
                <Input
                  id={line2Id}
                  name="line2"
                  autoComplete="address-line2"
                  defaultValue={initialValues.line2}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={suburbId} className="text-xs text-muted">
                  Suburb
                </label>
                <Input
                  id={suburbId}
                  name="suburb"
                  required
                  autoComplete="address-level2"
                  defaultValue={initialValues.suburb}
                  ref={registerRef("suburb")}
                  aria-invalid={Boolean(errors.suburb)}
                  aria-describedby={errors.suburb ? `${suburbId}-error` : undefined}
                />
                {errors.suburb ? (
                  <p
                    id={`${suburbId}-error`}
                    role="alert"
                    className="text-[11px] font-medium text-danger"
                  >
                    {errors.suburb}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={stateFieldId} className="text-xs text-muted">
                    State
                  </label>
                  <Input
                    id={stateFieldId}
                    name="state"
                    required
                    maxLength={3}
                    autoComplete="address-level1"
                    defaultValue={initialValues.state}
                    ref={registerRef("state")}
                    aria-invalid={Boolean(errors.state)}
                    aria-describedby={errors.state ? `${stateFieldId}-error` : undefined}
                  />
                  {errors.state ? (
                    <p
                      id={`${stateFieldId}-error`}
                      role="alert"
                      className="text-[11px] font-medium text-danger"
                    >
                      {errors.state}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={postcodeId} className="text-xs text-muted">
                    Postcode
                  </label>
                  <Input
                    id={postcodeId}
                    name="postcode"
                    required
                    inputMode="numeric"
                    mono
                    autoComplete="postal-code"
                    defaultValue={initialValues.postcode}
                    ref={registerRef("postcode")}
                    aria-invalid={Boolean(errors.postcode)}
                    aria-describedby={errors.postcode ? `${postcodeId}-error` : undefined}
                  />
                  {errors.postcode ? (
                    <p
                      id={`${postcodeId}-error`}
                      role="alert"
                      className="text-[11px] font-medium text-danger"
                    >
                      {errors.postcode}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </fieldset>

          <Field
            label="Tax file number"
            htmlFor={tfnFieldId}
            required
            hint="Stored encrypted — never shown in full or written to logs."
            error={errors.tfn}
          >
            <Input
              id={tfnFieldId}
              mono
              inputMode="numeric"
              autoComplete="off"
              placeholder="123 456 782"
              value={tfnFocused ? groupTfn(tfnDigits) : maskTfn(tfnDigits)}
              onChange={(e) => setTfnDigits(digitsOnly(e.target.value).slice(0, 9))}
              onFocus={() => setTfnFocused(true)}
              onBlur={handleTfnBlur}
              ref={registerRef("tfn")}
              aria-invalid={Boolean(errors.tfn)}
              aria-describedby={describedBy(tfnFieldId, true, errors.tfn)}
            />
          </Field>

          <Field
            label="Residency for tax purposes"
            htmlFor="residency"
            required
            hint={
              residency === "not-resident" ? (
                <span className="text-warn">
                  Non-resident and part-year returns are out of scope for this tool — this will be
                  caught and explained when you reach the review step.
                </span>
              ) : undefined
            }
          >
            <Select
              id="residency"
              name="residency"
              value={residency}
              onChange={(e) => setResidency(e.target.value as typeof residency)}
              aria-describedby={residency === "not-resident" ? "residency-hint" : undefined}
            >
              <option value="resident-full-year">Resident for the full year</option>
              <option value="not-resident">Not a resident / part-year</option>
            </Select>
          </Field>

          <Field label="Refund BSB" htmlFor="bsb" required hint="NNN-NNN" error={errors.bsb}>
            <Input
              id="bsb"
              name="bsb"
              required
              mono
              autoComplete="off"
              placeholder="063-018"
              defaultValue={initialValues.bsb}
              ref={registerRef("bsb")}
              aria-invalid={Boolean(errors.bsb)}
              aria-describedby={describedBy("bsb", true, errors.bsb)}
            />
          </Field>

          <Field
            label="Account number"
            htmlFor="accountNumber"
            required
            error={errors.accountNumber}
          >
            <Input
              id="accountNumber"
              name="accountNumber"
              required
              mono
              inputMode="numeric"
              autoComplete="off"
              defaultValue={initialValues.accountNumber}
              ref={registerRef("accountNumber")}
              aria-invalid={Boolean(errors.accountNumber)}
              aria-describedby={errors.accountNumber ? "accountNumber-error" : undefined}
            />
          </Field>

          <Field label="Account name" htmlFor="accountName" required error={errors.accountName}>
            <Input
              id="accountName"
              name="accountName"
              required
              defaultValue={initialValues.accountName}
              ref={registerRef("accountName")}
              aria-invalid={Boolean(errors.accountName)}
              aria-describedby={errors.accountName ? "accountName-error" : undefined}
            />
          </Field>

          <Field
            label="Study or training support loan"
            htmlFor="studyLoan"
            hint="Repayment is calculated on your repayment income, not just taxable income."
          >
            <Select
              id="studyLoan"
              name="studyLoan"
              defaultValue={initialValues.studyLoan}
              aria-describedby="studyLoan-hint"
            >
              <option value="no">No</option>
              <option value="yes">Yes — HELP or another study/training loan</option>
            </Select>
          </Field>

          <Field
            label="Days you held private hospital cover"
            htmlFor="privateCoverDays"
            required
            hint="0–366. Confirmed again in the questionnaire."
            error={errors.privateCoverDays}
          >
            <Input
              id="privateCoverDays"
              name="privateCoverDays"
              required
              mono
              inputMode="numeric"
              defaultValue={initialValues.privateCoverDays}
              ref={registerRef("privateCoverDays")}
              aria-invalid={Boolean(errors.privateCoverDays)}
              aria-describedby={describedBy("privateCoverDays", true, errors.privateCoverDays)}
            />
          </Field>

          <Field
            label="Dependent children"
            htmlFor="dependentChildren"
            required
            hint="Raises the Medicare levy family thresholds."
            error={errors.dependentChildren}
          >
            <Input
              id="dependentChildren"
              name="dependentChildren"
              required
              mono
              inputMode="numeric"
              defaultValue={initialValues.dependentChildren}
              ref={registerRef("dependentChildren")}
              aria-invalid={Boolean(errors.dependentChildren)}
              aria-describedby={describedBy("dependentChildren", true, errors.dependentChildren)}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spouse</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <label className="flex items-start gap-2.5 text-xs font-medium">
            <input
              type="checkbox"
              name="hasSpouse"
              checked={hasSpouse}
              onChange={(e) => setHasSpouse(e.target.checked)}
              className="mt-0.5 size-[18px] shrink-0 accent-accent"
            />
            <span>
              <span className="font-medium">I had a spouse for part or all of the year</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Needed for the Medicare levy surcharge, the private health rebate tier, and the levy
                reduction.
              </span>
            </span>
          </label>

          {hasSpouse ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Spouse name" htmlFor="spouseName" required error={errors.spouseName}>
                <Input
                  id="spouseName"
                  name="spouseName"
                  required
                  defaultValue={initialValues.spouseName}
                  onChange={(e) => setSpouseName(e.target.value)}
                  ref={registerRef("spouseName")}
                  aria-invalid={Boolean(errors.spouseName)}
                  aria-describedby={errors.spouseName ? "spouseName-error" : undefined}
                />
              </Field>

              <Field
                label="Spouse date of birth"
                htmlFor="spouseDob"
                required
                hint="DD/MM/YYYY"
                error={errors.spouseDob}
              >
                <Input
                  id="spouseDob"
                  name="spouseDob"
                  required
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  defaultValue={initialValues.spouseDob}
                  ref={registerRef("spouseDob")}
                  aria-invalid={Boolean(errors.spouseDob)}
                  aria-describedby={describedBy("spouseDob", true, errors.spouseDob)}
                />
              </Field>

              <Field
                label={
                  <>
                    Spouse taxable income <Badge tone="warn">estimated</Badge>
                  </>
                }
                htmlFor={spouseIncomeId}
                required
                hint="Your spouse may not have lodged yet. Enter your best estimate — it’s recorded as an assumption on the return and affects only the surcharge and the rebate."
                error={errors.spouseIncome}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id={spouseIncomeId}
                    name="spouseIncome"
                    required
                    mono
                    inputMode="decimal"
                    defaultValue={initialValues.spouseIncome}
                    ref={registerRef("spouseIncome")}
                    aria-invalid={Boolean(errors.spouseIncome)}
                    aria-describedby={describedBy(spouseIncomeId, true, errors.spouseIncome)}
                  />
                  {matchingCandidate ? (
                    <button
                      type="button"
                      onClick={copySpouseIncome}
                      className={buttonClassName({ variant: "ghost", size: "sm" })}
                    >
                      Copy from {matchingCandidate.name}&rsquo;s return
                    </button>
                  ) : null}
                </div>
              </Field>

              <Field
                label="Days spouse held private hospital cover"
                htmlFor="spouseCoverDays"
                required
                error={errors.spouseCoverDays}
              >
                <Input
                  id="spouseCoverDays"
                  name="spouseCoverDays"
                  required
                  mono
                  inputMode="numeric"
                  defaultValue={initialValues.spouseCoverDays}
                  ref={registerRef("spouseCoverDays")}
                  aria-invalid={Boolean(errors.spouseCoverDays)}
                  aria-describedby={describedBy("spouseCoverDays", true, errors.spouseCoverDays)}
                />
              </Field>
            </div>
          ) : null}
        </CardBody>
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
        <Link href="/" className={buttonClassName({ variant: "ghost" })}>
          Back
        </Link>
        <Button type="submit" variant="primary" aria-busy={pending} disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}

import { WizardStepSkeleton } from "../../../../components/WizardStepSkeleton";

export default function Loading() {
  return <WizardStepSkeleton step="details" title="Your details" lines={6} />;
}

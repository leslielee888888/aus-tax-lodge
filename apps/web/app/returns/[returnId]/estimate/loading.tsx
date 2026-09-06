import { WizardStepSkeleton } from "../../../../components/WizardStepSkeleton";

export default function Loading() {
  return <WizardStepSkeleton step="estimate" title="Your estimate" lines={3} />;
}

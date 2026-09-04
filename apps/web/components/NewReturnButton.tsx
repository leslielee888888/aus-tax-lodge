import { newReturnAction } from "../lib/actions";
import { Button, type ButtonSize } from "./Button";
import { PlusIcon } from "./icons";

/**
 * "New return" — a one-button form posting to {@link newReturnAction}. Works
 * without client JS; the action decides acknowledgement vs. straight to the
 * return.
 */
export function NewReturnButton({ size = "md" }: { size?: ButtonSize }) {
  return (
    <form action={newReturnAction}>
      <Button type="submit" variant="primary" size={size}>
        <PlusIcon className="size-3.5" />
        New return
      </Button>
    </form>
  );
}

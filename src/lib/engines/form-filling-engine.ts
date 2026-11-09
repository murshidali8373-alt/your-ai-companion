/**
 * ENGINE 4: FORM FILLING ENGINE
 *
 * Responsibilities:
 * - Match extracted user information to form fields
 * - Sequential interactability validation
 * - Native prototype descriptor event dispatching
 * - User value preservation by default
 * - Sensitive field security gating
 * - Explicit user-confirmation gate before final form submission
 */

import {
  executeFormFill,
  validateFieldInteractability,
  isSensitiveField,
  type FormFillResult,
  type UseFormFillerOptions,
  type PendingSubmissionData,
} from "@/hooks/use-form-filler";

export interface FormFillRequest {
  fields: Record<string, unknown>;
  options?: Partial<UseFormFillerOptions>;
  container?: HTMLElement | Document;
}

/**
 * Executes smart form fill workflow
 */
export async function runFormFill(req: FormFillRequest): Promise<FormFillResult> {
  return executeFormFill(req.fields, req.options, req.container);
}

export {
  executeFormFill,
  validateFieldInteractability,
  isSensitiveField,
  type FormFillResult,
  type UseFormFillerOptions,
  type PendingSubmissionData,
};

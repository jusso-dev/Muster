import { z } from "zod";

export const NotificationSchema = z.object({
  organisationId: z.string().uuid(),
  actorId: z.string().uuid(),
  type: z.enum(["mention","thread_reply","assigned_investigation","assigned_case","critical_alert","approval_required","approval_completed","workflow_failed","agent_run_completed","agent_run_failed","response_action_completed","integration_failure","sla_breach"]),
  title: z.string().max(180),
  preview: z.string().max(280).nullable(),
  sensitive: z.boolean(),
  target: z.object({ type: z.string(), id: z.string() }),
});

export function policySafePreview(notification: z.infer<typeof NotificationSchema>, allowSensitivePreview: boolean) {
  return notification.sensitive && !allowSensitivePreview
    ? { ...notification, preview: "Open Muster to view this restricted notification." }
    : notification;
}

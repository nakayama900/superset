import type { LinearClient, WorkflowState } from "@linear/sdk";
import { db } from "@superset/db/client";
import type { SelectTask } from "@superset/db/schema";
import { members, taskStatuses, tasks, users } from "@superset/db/schema";
import {
	getLinearClient,
	mapPriorityToLinear,
} from "@superset/trpc/integrations/linear";
import { and, eq } from "drizzle-orm";

export async function findLinearState(
	client: LinearClient,
	teamId: string,
	statusName: string,
): Promise<string | undefined> {
	const team = await client.team(teamId);
	const states = await team.states();
	const match = states.nodes.find(
		(s: WorkflowState) => s.name.toLowerCase() === statusName.toLowerCase(),
	);
	return match?.id;
}

async function resolveLinearAssigneeId(
	client: LinearClient,
	organizationId: string,
	userId: string,
): Promise<string | undefined> {
	const matchedUser = await db
		.select({ email: users.email })
		.from(users)
		.innerJoin(members, eq(members.userId, users.id))
		.where(
			and(eq(users.id, userId), eq(members.organizationId, organizationId)),
		)
		.limit(1)
		.then((rows) => rows[0]);
	if (!matchedUser?.email) return undefined;

	const linearUsers = await client.users({
		filter: { email: { eq: matchedUser.email } },
	});
	const linearUser = linearUsers.nodes[0];
	if (linearUsers.nodes.length === 1 && linearUser) {
		return linearUser.id;
	}
	return undefined;
}

export async function syncTaskToLinear(
	task: SelectTask,
	teamId: string | null,
): Promise<{
	success: boolean;
	externalId?: string;
	externalKey?: string;
	externalUrl?: string;
	error?: string;
}> {
	const client = await getLinearClient(task.organizationId);

	if (!client) {
		return { success: false, error: "No Linear connection found" };
	}

	try {
		const taskStatus = await db.query.taskStatuses.findFirst({
			where: eq(taskStatuses.id, task.statusId),
		});

		if (!taskStatus) {
			return { success: false, error: "Task status not found" };
		}

		// For existing Linear issues, resolve the team from the issue itself.
		// This ensures we look up workflow states in the correct team, even when
		// the task belongs to a different team than the configured newTasksTeamId.
		let resolvedTeamId = teamId;
		if (
			!resolvedTeamId &&
			task.externalProvider === "linear" &&
			task.externalId
		) {
			const existingIssue = await client.issue(task.externalId);
			const issueTeam = await existingIssue.team;
			resolvedTeamId = issueTeam?.id ?? null;
		}

		if (!resolvedTeamId) {
			return { success: false, error: "No team could be resolved" };
		}

		const stateId = await findLinearState(
			client,
			resolvedTeamId,
			taskStatus.name,
		);

		if (task.externalProvider === "linear" && task.externalId) {
			// Resolve assignee for Linear
			let linearAssigneeId: string | null | undefined; // undefined = don't change
			if (task.assigneeId === null && !task.assigneeExternalId) {
				// Explicitly unassign (only when no external assignee exists)
				linearAssigneeId = null;
			} else if (task.assigneeId) {
				linearAssigneeId =
					(await resolveLinearAssigneeId(
						client,
						task.organizationId,
						task.assigneeId,
					)) ?? undefined;
			}

			const result = await client.updateIssue(task.externalId, {
				title: task.title,
				description: task.description ?? undefined,
				priority: mapPriorityToLinear(task.priority),
				stateId,
				estimate: task.estimate ?? undefined,
				dueDate: task.dueDate?.toISOString().split("T")[0],
				...(linearAssigneeId !== undefined && {
					assigneeId: linearAssigneeId,
				}),
			});

			if (!result.success) {
				return { success: false, error: "Failed to update issue" };
			}

			const issue = await result.issue;
			if (!issue) {
				return { success: false, error: "Issue not returned" };
			}

			await db
				.update(tasks)
				.set({
					lastSyncedAt: new Date(),
					syncError: null,
				})
				.where(eq(tasks.id, task.id));

			return {
				success: true,
				externalId: issue.id,
				externalKey: issue.identifier,
				externalUrl: issue.url,
			};
		}

		// Resolve assignee for Linear (create)
		const createAssigneeId = task.assigneeId
			? await resolveLinearAssigneeId(
					client,
					task.organizationId,
					task.assigneeId,
				)
			: undefined;

		const result = await client.createIssue({
			teamId: resolvedTeamId,
			title: task.title,
			description: task.description ?? undefined,
			priority: mapPriorityToLinear(task.priority),
			stateId,
			estimate: task.estimate ?? undefined,
			dueDate: task.dueDate?.toISOString().split("T")[0],
			...(createAssigneeId && { assigneeId: createAssigneeId }),
		});

		if (!result.success) {
			return { success: false, error: "Failed to create issue" };
		}

		const issue = await result.issue;
		if (!issue) {
			return { success: false, error: "Issue not returned" };
		}

		await db
			.update(tasks)
			.set({
				externalProvider: "linear",
				externalId: issue.id,
				externalKey: issue.identifier,
				externalUrl: issue.url,
				lastSyncedAt: new Date(),
				syncError: null,
			})
			.where(eq(tasks.id, task.id));

		return {
			success: true,
			externalId: issue.id,
			externalKey: issue.identifier,
			externalUrl: issue.url,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";

		await db
			.update(tasks)
			.set({ syncError: errorMessage })
			.where(eq(tasks.id, task.id));

		return { success: false, error: errorMessage };
	}
}

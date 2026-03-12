import { db } from "@superset/db/client";
import type { LinearConfig } from "@superset/db/schema";
import { integrationConnections, tasks } from "@superset/db/schema";
import { Receiver } from "@upstash/qstash";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/env";
import { syncTaskToLinear } from "./syncTaskToLinear";

const receiver = new Receiver({
	currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
	nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
});

const payloadSchema = z.object({
	taskId: z.string().min(1),
	teamId: z.string().optional(),
});

async function getNewTasksTeamId(
	organizationId: string,
): Promise<string | null> {
	const connection = await db.query.integrationConnections.findFirst({
		where: and(
			eq(integrationConnections.organizationId, organizationId),
			eq(integrationConnections.provider, "linear"),
		),
	});

	if (!connection?.config) {
		return null;
	}

	const config = connection.config as LinearConfig;
	return config.newTasksTeamId ?? null;
}

export async function POST(request: Request) {
	const body = await request.text();
	const signature = request.headers.get("upstash-signature");

	// Skip signature verification in development (QStash can't reach localhost)
	const isDev = env.NODE_ENV === "development";

	if (!isDev) {
		if (!signature) {
			return Response.json({ error: "Missing signature" }, { status: 401 });
		}

		const isValid = await receiver.verify({
			body,
			signature,
			url: `${env.NEXT_PUBLIC_API_URL}/api/integrations/linear/jobs/sync-task`,
		});

		if (!isValid) {
			return Response.json({ error: "Invalid signature" }, { status: 401 });
		}
	}

	const parsed = payloadSchema.safeParse(JSON.parse(body));
	if (!parsed.success) {
		return Response.json({ error: "Invalid payload" }, { status: 400 });
	}

	const { taskId, teamId } = parsed.data;

	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, taskId),
	});

	if (!task) {
		return Response.json({ error: "Task not found", skipped: true });
	}

	const resolvedTeamId =
		teamId ?? (await getNewTasksTeamId(task.organizationId));

	// resolvedTeamId may be null — syncTaskToLinear will resolve it from the
	// existing Linear issue when syncing back an already-linked task.
	const result = await syncTaskToLinear(task, resolvedTeamId);

	if (!result.success) {
		return Response.json({ error: result.error }, { status: 500 });
	}

	return Response.json({
		success: true,
		externalId: result.externalId,
		externalKey: result.externalKey,
	});
}

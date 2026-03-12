import { describe, expect, mock, test } from "bun:test";
import type { SelectTask } from "@superset/db/schema";

// --- Mocks ---------------------------------------------------------------
// We mock external dependencies (DB, Linear client) so we can unit-test
// the core sync logic without network access or env variables.

const mockFindFirstTaskStatus = mock();
const mockUpdateTasks = mock();

mock.module("@superset/db/client", () => ({
	db: {
		query: {
			taskStatuses: { findFirst: mockFindFirstTaskStatus },
		},
		update: () => ({
			set: () => ({
				where: mockUpdateTasks,
			}),
		}),
	},
}));

mock.module("drizzle-orm", () => ({
	eq: (a: unknown, b: unknown) => ({ a, b }),
	and: (...args: unknown[]) => args,
}));

mock.module("@superset/db/schema", () => ({
	integrationConnections: {
		organizationId: "organizationId",
		provider: "provider",
	},
	members: {},
	taskStatuses: { id: "id" },
	tasks: { id: "id" },
	users: {},
}));

const mockUpdateIssue = mock();
const mockCreateIssue = mock();
const mockIssue = mock();
const mockTeam = mock();

const mockLinearClient = {
	updateIssue: mockUpdateIssue,
	createIssue: mockCreateIssue,
	issue: mockIssue,
	team: mockTeam,
};

mock.module("@superset/trpc/integrations/linear", () => ({
	getLinearClient: mock(() => Promise.resolve(mockLinearClient)),
	mapPriorityToLinear: (p: string) => (p === "high" ? 2 : 0),
}));

// --- Helpers -------------------------------------------------------------

function makeTask(overrides: Partial<SelectTask> = {}): SelectTask {
	return {
		id: "task-1",
		slug: "TASK-1",
		title: "Test task",
		description: null,
		statusId: "status-1",
		priority: "high",
		organizationId: "org-1",
		assigneeId: null,
		assigneeExternalId: null,
		assigneeDisplayName: null,
		assigneeAvatarUrl: null,
		creatorId: null,
		branch: null,
		prUrl: null,
		estimate: null,
		dueDate: null,
		labels: [],
		startedAt: null,
		completedAt: null,
		externalProvider: null,
		externalId: null,
		externalKey: null,
		externalUrl: null,
		lastSyncedAt: null,
		syncError: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		deletedAt: null,
		...overrides,
	} as SelectTask;
}

function resetMocks() {
	mockFindFirstTaskStatus.mockReset();
	mockUpdateTasks.mockReset();
	mockUpdateIssue.mockReset();
	mockCreateIssue.mockReset();
	mockIssue.mockReset();
	mockTeam.mockReset();
}

// --- Tests ---------------------------------------------------------------

// Import after mocks are set up
const { syncTaskToLinear } = await import("./syncTaskToLinear");

describe("syncTaskToLinear", () => {
	describe("existing Linear issues (update path)", () => {
		test("resolves team from the Linear issue when no teamId is provided", async () => {
			resetMocks();

			mockFindFirstTaskStatus.mockResolvedValue({
				id: "status-1",
				name: "In Progress",
			});

			// client.issue() returns issue with team
			mockIssue.mockResolvedValue({
				team: Promise.resolve({ id: "linear-team-123" }),
			});

			// client.team() returns team with states
			mockTeam.mockResolvedValue({
				states: () =>
					Promise.resolve({
						nodes: [
							{ id: "state-in-progress", name: "In Progress" },
							{ id: "state-done", name: "Done" },
						],
					}),
			});

			mockUpdateIssue.mockResolvedValue({
				success: true,
				issue: Promise.resolve({
					id: "linear-issue-1",
					identifier: "TEAM-1",
					url: "https://linear.app/team/issue/TEAM-1",
				}),
			});

			mockUpdateTasks.mockResolvedValue(undefined);

			const task = makeTask({
				externalProvider: "linear",
				externalId: "linear-issue-1",
				externalKey: "TEAM-1",
			});

			// BUG REPRODUCTION: passing null teamId (no newTasksTeamId configured).
			// Before the fix, syncTaskToLinear required a non-null teamId param and
			// the POST handler would bail early with "No team configured" when
			// newTasksTeamId was not set — even for already-linked Linear issues.
			const result = await syncTaskToLinear(task, null);

			expect(result.success).toBe(true);
			expect(result.externalId).toBe("linear-issue-1");

			// Verify the issue was fetched to resolve the team
			expect(mockIssue).toHaveBeenCalledWith("linear-issue-1");

			// Verify the correct team was used for state lookup
			expect(mockTeam).toHaveBeenCalledWith("linear-team-123");

			// Verify updateIssue was called with the correct stateId
			expect(mockUpdateIssue).toHaveBeenCalledWith("linear-issue-1", {
				title: "Test task",
				description: undefined,
				priority: 2,
				stateId: "state-in-progress",
				estimate: undefined,
				dueDate: undefined,
				assigneeId: null, // explicitly unassigned (no assignee, no external assignee)
			});
		});

		test("uses provided teamId without fetching issue when teamId is given", async () => {
			resetMocks();

			mockFindFirstTaskStatus.mockResolvedValue({
				id: "status-1",
				name: "Done",
			});

			mockTeam.mockResolvedValue({
				states: () =>
					Promise.resolve({
						nodes: [{ id: "state-done", name: "Done" }],
					}),
			});

			mockUpdateIssue.mockResolvedValue({
				success: true,
				issue: Promise.resolve({
					id: "linear-issue-1",
					identifier: "TEAM-1",
					url: "https://linear.app/team/issue/TEAM-1",
				}),
			});

			mockUpdateTasks.mockResolvedValue(undefined);

			const task = makeTask({
				externalProvider: "linear",
				externalId: "linear-issue-1",
			});

			const result = await syncTaskToLinear(task, "explicit-team-id");

			expect(result.success).toBe(true);
			// Should NOT fetch issue since teamId was provided
			expect(mockIssue).not.toHaveBeenCalled();
			expect(mockTeam).toHaveBeenCalledWith("explicit-team-id");
		});
	});

	describe("new tasks (create path)", () => {
		test("fails when no teamId is provided for a new task", async () => {
			resetMocks();

			mockFindFirstTaskStatus.mockResolvedValue({
				id: "status-1",
				name: "Todo",
			});

			const task = makeTask(); // no externalProvider / externalId

			const result = await syncTaskToLinear(task, null);

			expect(result.success).toBe(false);
			expect(result.error).toBe("No team could be resolved");
		});

		test("creates issue in Linear when teamId is provided", async () => {
			resetMocks();

			mockFindFirstTaskStatus.mockResolvedValue({
				id: "status-1",
				name: "Todo",
			});

			mockTeam.mockResolvedValue({
				states: () =>
					Promise.resolve({
						nodes: [{ id: "state-todo", name: "Todo" }],
					}),
			});

			mockCreateIssue.mockResolvedValue({
				success: true,
				issue: Promise.resolve({
					id: "new-linear-issue",
					identifier: "TEAM-2",
					url: "https://linear.app/team/issue/TEAM-2",
				}),
			});

			mockUpdateTasks.mockResolvedValue(undefined);

			const task = makeTask();

			const result = await syncTaskToLinear(task, "team-for-new-tasks");

			expect(result.success).toBe(true);
			expect(result.externalId).toBe("new-linear-issue");
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					teamId: "team-for-new-tasks",
					title: "Test task",
					stateId: "state-todo",
				}),
			);
		});
	});
});

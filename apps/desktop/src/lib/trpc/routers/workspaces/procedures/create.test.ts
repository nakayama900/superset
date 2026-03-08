/**
 * Tests for the createBranchWorkspace procedure.
 *
 * Regression test for issue #2252:
 * "Worktree creation UI always fails with 'main workspace already exists' error"
 *
 * Root cause: createBranchWorkspace threw an error whenever an existing branch
 * workspace was on a different branch than the one requested, making it
 * impossible to switch the branch workspace via the UI.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";

// ─── Mock factories ────────────────────────────────────────────────────────────

const mockGetBranchWorkspace = mock(
	() => undefined as Record<string, unknown> | undefined,
);
const mockTouchWorkspace = mock((_id: string) => {});
const mockSetLastActiveWorkspace = mock((_id: string) => {});
const mockActivateProject = mock((_project: unknown) => {});
const mockGetMaxProjectChildTabOrder = mock((_projectId: string) => 0);
const mockFindWorktreeWorkspaceByBranch = mock(
	(_args: unknown) => null as null,
);
const mockFindOrphanedWorktreeByBranch = mock((_args: unknown) => null as null);

const mockSafeCheckoutBranch = mock(
	async (_repoPath: string, _branch: string) => {},
);
const mockGetCurrentBranch = mock(
	async (_repoPath: string) => "main" as string | null,
);
const mockListBranches = mock(async (_repoPath: string) => ({
	local: ["main", "feature-x"],
	remote: [] as string[],
}));

// ─── Module mocks ──────────────────────────────────────────────────────────────

mock.module("lib/trpc/routers/workspaces/utils/db-helpers", () => ({
	getBranchWorkspace: mockGetBranchWorkspace,
	touchWorkspace: mockTouchWorkspace,
	setLastActiveWorkspace: mockSetLastActiveWorkspace,
	activateProject: mockActivateProject,
	getMaxProjectChildTabOrder: mockGetMaxProjectChildTabOrder,
	findWorktreeWorkspaceByBranch: mockFindWorktreeWorkspaceByBranch,
	findOrphanedWorktreeByBranch: mockFindOrphanedWorktreeByBranch,
	getProject: mock(() => null),
	getWorktree: mock(() => null),
}));

// NotGitRepoError is imported by lib/trpc/index.ts — must be included in mock
class NotGitRepoError extends Error {
	constructor(path: string) {
		super(`Not a git repo: ${path}`);
		this.name = "NotGitRepoError";
	}
}

mock.module("lib/trpc/routers/workspaces/utils/git", () => ({
	NotGitRepoError,
	safeCheckoutBranch: mockSafeCheckoutBranch,
	getCurrentBranch: mockGetCurrentBranch,
	listBranches: mockListBranches,
	generateBranchName: mock(() => "new-branch"),
	getBranchPrefix: mock(async () => undefined),
	getBranchWorktreePath: mock(async () => null),
	sanitizeAuthorPrefix: mock((s: string) => s),
	sanitizeBranchNameWithMaxLength: mock((s: string) => s),
	worktreeExists: mock(async () => false),
	createWorktreeFromPr: mock(async () => {}),
	getPrInfo: mock(async () => ({})),
	getPrLocalBranchName: mock(() => "pr-branch"),
	parsePrUrl: mock(() => null),
	listExternalWorktrees: mock(async () => []),
	checkoutBranch: mock(async () => {}),
	checkBranchCheckoutSafety: mock(async () => ({ safe: true })),
}));

mock.module("main/lib/workspace-init-manager", () => ({
	workspaceInitManager: { startJob: mock(() => {}) },
}));

mock.module("lib/trpc/routers/workspaces/utils/setup", () => ({
	loadSetupConfig: mock(() => null),
	copySupersetConfigToWorktree: mock(() => {}),
}));

mock.module("lib/trpc/routers/workspaces/utils/base-branch-config", () => ({
	setBranchBaseConfig: mock(async () => {}),
}));

mock.module("lib/trpc/routers/workspaces/utils/base-branch", () => ({
	resolveWorkspaceBaseBranch: mock(() => "main"),
}));

mock.module("lib/trpc/routers/workspaces/utils/ai-name", () => ({
	attemptWorkspaceAutoRenameFromPrompt: mock(async () => ({
		status: "skipped",
		warning: undefined,
	})),
}));

mock.module("lib/trpc/routers/workspaces/utils/workspace-init", () => ({
	initializeWorkspaceWorktree: mock(() => {}),
}));

mock.module("lib/trpc/routers/workspaces/utils/resolve-worktree-path", () => ({
	resolveWorktreePath: mock(() => "/tmp/worktrees/feature-x"),
}));

// Override the global localDb mock to return a project and track branch updates
let storedWorkspaceBranch = "main";

mock.module("main/lib/local-db", () => {
	const fakeProject = {
		id: "project-1",
		mainRepoPath: "/tmp/repo",
		defaultBranch: "main",
		workspaceBaseBranch: null,
		branchPrefixMode: null,
		branchPrefixCustom: null,
	};
	const fakeNewWorkspace = {
		id: "new-ws-1",
		projectId: "project-1",
		type: "branch" as const,
		branch: "feature-x",
		name: "feature-x",
		tabOrder: 0,
		deletingAt: null,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastOpenedAt: Date.now(),
		isUnnamed: false,
		worktreeId: null,
	};

	return {
		localDb: {
			select: mock(() => ({
				from: mock(() => ({
					where: mock(() => ({
						get: mock(() => fakeProject),
						all: mock(() => []),
					})),
					get: mock(() => fakeProject),
					all: mock(() => []),
				})),
			})),
			insert: mock(() => ({
				values: mock(() => ({
					returning: mock(() => ({
						get: mock(() => fakeNewWorkspace),
					})),
					onConflictDoNothing: mock(() => ({
						returning: mock(() => ({
							all: mock(() => [fakeNewWorkspace]),
						})),
					})),
					run: mock(() => {}),
				})),
			})),
			update: mock(() => ({
				set: mock((fields: { branch?: string }) => {
					if (fields.branch) storedWorkspaceBranch = fields.branch;
					return {
						where: mock(() => ({
							run: mock(() => {}),
							returning: mock(() => ({
								get: mock(() => ({
									...fakeNewWorkspace,
									branch: storedWorkspaceBranch,
								})),
							})),
						})),
					};
				}),
			})),
			delete: mock(() => ({
				where: mock(() => ({ run: mock(() => {}) })),
			})),
		},
	};
});

// ─── Lazy import (after mocks are registered) ──────────────────────────────────

type CreateProcedures = typeof import("./create")["createCreateProcedures"];
let createCreateProcedures: CreateProcedures;

beforeAll(async () => {
	const mod = await import("./create");
	createCreateProcedures = mod.createCreateProcedures;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createBranchWorkspace — branch switching (issue #2252)", () => {
	test("succeeds when no existing branch workspace exists", async () => {
		mockGetBranchWorkspace.mockReturnValue(undefined);
		mockSafeCheckoutBranch.mockResolvedValue(undefined);

		const procedures = createCreateProcedures();
		// biome-ignore lint/suspicious/noExplicitAny: tRPC internal typing
		const caller = (procedures as any).createCaller({});

		const result = await caller.createBranchWorkspace({
			projectId: "project-1",
			branch: "feature-x",
		});

		expect(result.wasExisting).toBe(false);
	});

	test("returns existing workspace when already on the requested branch", async () => {
		mockGetBranchWorkspace.mockReturnValue({
			id: "ws-1",
			projectId: "project-1",
			type: "branch",
			branch: "feature-x",
			name: "feature-x",
			tabOrder: 0,
			deletingAt: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastOpenedAt: Date.now(),
			isUnnamed: false,
			worktreeId: null,
		});

		const procedures = createCreateProcedures();
		// biome-ignore lint/suspicious/noExplicitAny: tRPC internal typing
		const caller = (procedures as any).createCaller({});

		const result = await caller.createBranchWorkspace({
			projectId: "project-1",
			branch: "feature-x",
		});

		expect(result.wasExisting).toBe(true);
		expect(result.workspace.branch).toBe("feature-x");
	});

	test("switches branch workspace to a different branch instead of throwing", async () => {
		// Bug scenario from issue #2252:
		// Main workspace is on 'main', user selects 'feature-x' in the UI.
		// Previously: threw "A main workspace already exists on branch 'main'"
		// Expected: switches to 'feature-x' and returns the updated workspace.
		mockGetBranchWorkspace.mockReturnValue({
			id: "ws-1",
			projectId: "project-1",
			type: "branch",
			branch: "main",
			name: "main",
			tabOrder: 0,
			deletingAt: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastOpenedAt: Date.now(),
			isUnnamed: false,
			worktreeId: null,
		});
		mockSafeCheckoutBranch.mockResolvedValue(undefined);
		storedWorkspaceBranch = "main";

		const procedures = createCreateProcedures();
		// biome-ignore lint/suspicious/noExplicitAny: tRPC internal typing
		const caller = (procedures as any).createCaller({});

		// Must not throw "A main workspace already exists on branch 'main'"
		const result = await caller.createBranchWorkspace({
			projectId: "project-1",
			branch: "feature-x",
		});

		expect(result.wasExisting).toBe(true);
		// The returned workspace should reflect the new branch
		expect(result.workspace.branch).toBe("feature-x");
		// safeCheckoutBranch must be called to do the actual git checkout
		expect(mockSafeCheckoutBranch).toHaveBeenCalledWith(
			"/tmp/repo",
			"feature-x",
		);
	});
});

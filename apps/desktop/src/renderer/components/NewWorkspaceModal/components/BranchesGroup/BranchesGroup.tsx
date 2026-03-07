import { CommandEmpty, CommandGroup, CommandItem } from "@superset/ui/command";
import { toast } from "@superset/ui/sonner";
import { GoGitBranch, GoGlobe } from "react-icons/go";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useCreateBranchWorkspace } from "renderer/react-query/workspaces";

interface BranchesGroupProps {
	projectId: string | null;
	onClose: () => void;
}

export function BranchesGroup({ projectId, onClose }: BranchesGroupProps) {
	const createBranchWorkspace = useCreateBranchWorkspace();

	const { data } = electronTrpc.projects.getBranches.useQuery(
		{ projectId: projectId ?? "" },
		{ enabled: !!projectId },
	);

	const defaultBranch = data?.defaultBranch ?? "main";

	const branches = (data?.branches ?? [])
		.sort((a, b) => {
			// Default branch first
			if (a.name === defaultBranch) return -1;
			if (b.name === defaultBranch) return 1;
			// Local before remote-only
			if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
			// Then alphabetically
			return a.name.localeCompare(b.name);
		})
		.slice(0, 40);

	if (!projectId) {
		return (
			<CommandGroup>
				<CommandEmpty>Select a project to view branches.</CommandEmpty>
			</CommandGroup>
		);
	}

	return (
		<CommandGroup>
			<CommandEmpty>No branches found.</CommandEmpty>
			{branches.map((branch) => (
				<CommandItem
					key={branch.name}
					value={branch.name}
					onSelect={() => {
						onClose();
						toast.promise(
							createBranchWorkspace.mutateAsync({
								projectId,
								branch: branch.name,
							}),
							{
								loading: "Creating workspace from branch...",
								success: "Workspace created",
								error: (err) =>
									err instanceof Error
										? err.message
										: "Failed to create workspace",
							},
						);
					}}
					className="group"
				>
					{branch.isLocal ? (
						<GoGitBranch className="size-4 shrink-0 text-muted-foreground" />
					) : (
						<GoGlobe className="size-4 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate flex-1">{branch.name}</span>
					<span className="text-xs text-muted-foreground shrink-0 hidden group-data-[selected=true]:inline">
						Open →
					</span>
				</CommandItem>
			))}
		</CommandGroup>
	);
}

import type { SimpleGit } from "simple-git";

export async function getRemoteUrl(git: SimpleGit): Promise<string | null> {
	try {
		const url = await git.remote(["get-url", "origin"]);
		return url?.trim() || null;
	} catch {
		return null;
	}
}

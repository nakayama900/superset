/**
 * Reproduction tests for issue #2241:
 * "Terminal stream events lack client-side batching before xterm.write()"
 *
 * Root cause: handleStreamData in useTerminalStream.ts calls xterm.write()
 * immediately for each incoming IPC message. When agents produce rapid output
 * (Codex streaming, Claude Code tool results, npm install logs), each message
 * becomes a separate xterm.write() call, causing redundant parser processing,
 * WebGL texture atlas updates, and potential layout recalculations.
 *
 * Fix: coalesce writes arriving within a single animation frame into one
 * xterm.write() call via requestAnimationFrame, reducing overhead when many
 * messages arrive between frames.
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal model of the write path extracted from handleStreamData.
// Two versions are modelled:
//   - makeUnbatchedWriter: mirrors the current (buggy) behaviour — one
//     xterm.write() call per stream event.
//   - makeBatchedWriter: mirrors the fixed behaviour — writes are coalesced
//     per animation frame into a single xterm.write() call.
// ---------------------------------------------------------------------------

function makeUnbatchedWriter(writeToXterm: (data: string) => void): {
	handleData: (data: string) => void;
} {
	return {
		handleData: (data: string) => {
			writeToXterm(data);
		},
	};
}

function makeBatchedWriter(writeToXterm: (data: string) => void): {
	handleData: (data: string) => void;
	flush: () => void;
} {
	const pendingWrites: string[] = [];
	let rafScheduled = false;
	const pendingRafs: Array<() => void> = [];

	const mockRaf = (cb: () => void): number => {
		pendingRafs.push(cb);
		return pendingRafs.length;
	};

	const scheduleWrite = (data: string) => {
		pendingWrites.push(data);
		if (!rafScheduled) {
			rafScheduled = true;
			mockRaf(() => {
				const batch = pendingWrites.join("");
				pendingWrites.length = 0;
				rafScheduled = false;
				writeToXterm(batch);
			});
		}
	};

	const flush = () => {
		while (pendingRafs.length > 0) {
			const cb = pendingRafs.shift();
			cb?.();
		}
	};

	return { handleData: scheduleWrite, flush };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("xterm write coalescing — issue #2241", () => {
	it("unbatched: each stream event triggers a separate xterm.write() call", () => {
		const writeCalls: string[] = [];
		const { handleData } = makeUnbatchedWriter((data) => writeCalls.push(data));

		handleData("hello ");
		handleData("world");
		handleData("!");

		// BUG: three separate writes instead of one
		expect(writeCalls).toEqual(["hello ", "world", "!"]);
		expect(writeCalls.length).toBe(3);
	});

	it("batched: multiple stream events within one frame produce a single xterm.write() call", () => {
		const writeCalls: string[] = [];
		const { handleData, flush } = makeBatchedWriter((data) =>
			writeCalls.push(data),
		);

		// Simulate rapid arrival of three data events before the next frame
		handleData("hello ");
		handleData("world");
		handleData("!");

		// No writes have happened yet — we're still within the same frame
		expect(writeCalls.length).toBe(0);

		// Flush the animation frame
		flush();

		// All three chunks are coalesced into one xterm.write() call
		expect(writeCalls.length).toBe(1);
		expect(writeCalls[0]).toBe("hello world!");
	});

	it("batched: events arriving in separate frames produce separate xterm.write() calls", () => {
		const writeCalls: string[] = [];
		const { handleData, flush } = makeBatchedWriter((data) =>
			writeCalls.push(data),
		);

		// First frame: one event
		handleData("first");
		flush();

		// Second frame: two events
		handleData("second ");
		handleData("chunk");
		flush();

		expect(writeCalls.length).toBe(2);
		expect(writeCalls[0]).toBe("first");
		expect(writeCalls[1]).toBe("second chunk");
	});

	it("batched: a single event produces exactly one xterm.write() call per frame", () => {
		const writeCalls: string[] = [];
		const { handleData, flush } = makeBatchedWriter((data) =>
			writeCalls.push(data),
		);

		handleData("only one");
		flush();

		expect(writeCalls.length).toBe(1);
		expect(writeCalls[0]).toBe("only one");
	});

	it("batched: 100 rapid events are coalesced into one xterm.write() call", () => {
		const writeCalls: string[] = [];
		const { handleData, flush } = makeBatchedWriter((data) =>
			writeCalls.push(data),
		);

		const chunks = Array.from({ length: 100 }, (_, i) => `chunk${i}\n`);
		for (const chunk of chunks) {
			handleData(chunk);
		}

		flush();

		// 100 IPC messages → 1 xterm.write() call with all data joined
		expect(writeCalls.length).toBe(1);
		expect(writeCalls[0]).toBe(chunks.join(""));
	});
});

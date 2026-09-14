import { extractTempDir } from "./paths";
import { materializeBundleRoot } from "./extract-archive";
import { runSidecarTest, type SidecarTestResult } from "./python-bridge";
import { recordSessionTest } from "./verification-cache";

export type TestProgress = {
  phase: "prepare" | "test" | "done" | "error";
  message: string;
};

export type TestOutcome = SidecarTestResult & {
  error?: string;
};

export async function runTestPipeline(
  sourcePath: string,
  emit: (p: TestProgress) => void
): Promise<TestOutcome> {
  try {
    emit({ phase: "prepare", message: "Reading your delivery folder or archive..." });
    const tempRoot = extractTempDir();
    const bundleDir = await materializeBundleRoot(sourcePath, tempRoot);

    emit({
      phase: "test",
      message: "Testing session with Telegram (no download, no Desktop launch)...",
    });

    const result = await runSidecarTest(bundleDir, (line) => {
      emit({ phase: "test", message: line });
    });

    recordSessionTest(sourcePath, result.status, result.ok);

    const message =
      result.message ??
      (result.ok
        ? "Session looks good."
        : "Session test did not pass. See activity log for details.");

    if (result.ok) {
      emit({ phase: "done", message });
    } else {
      emit({ phase: "error", message });
    }

    return { ...result, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ phase: "error", message });
    return { ok: false, status: "error", message, error: message };
  }
}

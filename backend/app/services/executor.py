from datetime import datetime, timezone
from pathlib import Path
import shutil
from typing import List, Optional
import uuid

from app.schemas.operation import (
    ExecutedOperationItem,
    ExecutePlanRequest,
    ExecutionResponse,
    OperationStatus,
    UndoOperationResponse,
    UndoPlanResponse,
    UndoStatus,
)
from app.schemas.plan import CleanupPlanResponse, PlanActionType
from app.services.journal import operation_journal
from app.services.plan import cleanup_plan_service


class ExecutionService:
    """Service for safely executing approved cleanup plans and performing safe undo operations.
    
    SAFETY INVARIANTS:
    1. NEVER executes a plan without explicit confirmation.
    2. REVALIDATES the entire plan immediately before executing any moves.
    3. REJECTS stale plans where source files or destination states have changed.
    4. NEVER overwrites existing files during execution or undo.
    5. NEVER deletes duplicate files (flags only).
    6. VALIDATES every path against the authorized root.
    7. Uses deterministic Python filesystem APIs (never shell commands).
    8. Records all operations transactionally in SQLite journal.
    """

    def __init__(self, journal=None) -> None:
        self.journal = journal or operation_journal

    def validate_plan_before_execution(
        self, plan: CleanupPlanResponse, canonical_root: Path
    ) -> None:
        """Thoroughly revalidate the entire plan prior to making any filesystem changes.
        
        Raises ValueError if any source file is missing/moved, or if any destination
        is now occupied by another file.
        """
        if not canonical_root.exists() or not canonical_root.is_dir():
            raise ValueError(
                f"Authorized scan root does not exist or is not a directory: '{canonical_root}'"
            )

        for item in plan.items:
            # We only execute MOVE, RENAME, and MOVE_AND_RENAME
            if item.action in [
                PlanActionType.MOVE,
                PlanActionType.RENAME,
                PlanActionType.MOVE_AND_RENAME,
            ] and item.proposed_path:
                src_full = (canonical_root / item.original_path).resolve()
                dest_full = (canonical_root / item.proposed_path).resolve()

                # Sandboxing validation
                try:
                    if not src_full.is_relative_to(canonical_root):
                        raise ValueError(
                            f"Security violation: Source path '{item.original_path}' escapes authorized root."
                        )
                    if not dest_full.is_relative_to(canonical_root):
                        raise ValueError(
                            f"Security violation: Proposed destination '{item.proposed_path}' escapes authorized root."
                        )
                except AttributeError:
                    try:
                        src_full.relative_to(canonical_root)
                        dest_full.relative_to(canonical_root)
                    except ValueError:
                        raise ValueError(
                            f"Security violation: Path escapes authorized root directory."
                        )

                # Source existence check
                if not src_full.exists() or not src_full.is_file():
                    raise ValueError(
                        f"Stale plan: Source file '{item.original_path}' no longer exists on disk. "
                        "The filesystem has changed; please generate a fresh cleanup plan."
                    )

                # Destination availability check (never overwrite!)
                if dest_full.exists() and dest_full != src_full:
                    raise ValueError(
                        f"Destination conflict: Proposed destination '{item.proposed_path}' "
                        "is already occupied by an existing file on disk."
                    )

    def execute_plan(self, request: ExecutePlanRequest) -> ExecutionResponse:
        """Execute an approved cleanup plan with atomic per-operation journaling.
        
        Requires explicit confirmation approval. Revalidates entire plan first.
        """
        if not request.confirm_approval:
            raise ValueError(
                "Execution rejected: Explicit user approval confirmation is required."
            )

        plan = cleanup_plan_service.get_plan(request.plan_id)
        if not plan:
            raise KeyError(f"Cleanup plan with ID '{request.plan_id}' not found.")

        canonical_root = Path(plan.target_path).resolve()

        # Step 1: Pre-execution validation
        self.validate_plan_before_execution(plan, canonical_root)

        executed_at = datetime.now(timezone.utc).isoformat()
        executed_items: List[ExecutedOperationItem] = []

        total_planned = 0
        successful_ops = 0
        failed_ops = 0
        skipped_ops = 0

        # Step 2: Sequential atomic execution
        for item in plan.items:
            # Duplicates and Skips are not moved on disk
            if item.action in [PlanActionType.SKIP, PlanActionType.DUPLICATE_FLAG] or not item.proposed_path:
                skipped_ops += 1
                continue

            total_planned += 1
            op_id = str(uuid.uuid4())
            src_full = (canonical_root / item.original_path).resolve()
            dest_full = (canonical_root / item.proposed_path).resolve()

            try:
                # Per-file pre-execution check
                if not src_full.exists():
                    raise FileNotFoundError(f"Source file '{item.original_path}' missing.")
                if dest_full.exists() and dest_full != src_full:
                    raise FileExistsError(
                        f"Destination '{item.proposed_path}' already exists; overwrite prevented."
                    )

                st = src_full.stat()
                file_size = st.st_size
                mtime_before = st.st_mtime

                # Ensure target directory exists
                dest_full.parent.mkdir(parents=True, exist_ok=True)

                # Execute move deterministically using standard library
                shutil.move(str(src_full), str(dest_full))

                # Record in persistent SQLite journal
                self.journal.record_operation(
                    operation_id=op_id,
                    plan_id=plan.plan_id,
                    target_root=str(canonical_root),
                    original_path=item.original_path,
                    destination_path=item.proposed_path,
                    operation_type=item.action.value,
                    status=OperationStatus.COMPLETED,
                    undo_status=UndoStatus.REVERSIBLE,
                    file_size_bytes=file_size,
                    file_mtime_before=mtime_before,
                )

                successful_ops += 1
                executed_items.append(
                    ExecutedOperationItem(
                        operation_id=op_id,
                        plan_id=plan.plan_id,
                        original_path=item.original_path,
                        destination_path=item.proposed_path,
                        operation_type=item.action.value,
                        status=OperationStatus.COMPLETED,
                        undo_status=UndoStatus.REVERSIBLE,
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        file_size_bytes=file_size,
                    )
                )

            except Exception as e:
                failed_ops += 1
                error_msg = str(e)
                self.journal.record_operation(
                    operation_id=op_id,
                    plan_id=plan.plan_id,
                    target_root=str(canonical_root),
                    original_path=item.original_path,
                    destination_path=item.proposed_path,
                    operation_type=item.action.value,
                    status=OperationStatus.FAILED,
                    undo_status=UndoStatus.UNREVERSIBLE,
                    file_size_bytes=item.size_bytes,
                    error_message=error_msg,
                )

                executed_items.append(
                    ExecutedOperationItem(
                        operation_id=op_id,
                        plan_id=plan.plan_id,
                        original_path=item.original_path,
                        destination_path=item.proposed_path,
                        operation_type=item.action.value,
                        status=OperationStatus.FAILED,
                        undo_status=UndoStatus.UNREVERSIBLE,
                        error_message=error_msg,
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        file_size_bytes=item.size_bytes,
                    )
                )

        overall_status = "completed"
        if failed_ops > 0 and successful_ops > 0:
            overall_status = "partially_completed"
        elif failed_ops > 0 and successful_ops == 0:
            overall_status = "failed"

        return ExecutionResponse(
            plan_id=plan.plan_id,
            executed_at=executed_at,
            status=overall_status,
            total_planned=total_planned,
            successful_operations=successful_ops,
            failed_operations=failed_ops,
            skipped_operations=skipped_ops,
            operations=executed_items,
        )

    def undo_operation(self, operation_id: str) -> UndoOperationResponse:
        """Safely reverse a completed move or rename operation.
        
        Validates that the file remains intact at the destination and that
        the original path is not occupied.
        """
        record = self.journal.get_operation(operation_id)
        if not record:
            raise KeyError(f"Operation record '{operation_id}' not found.")

        orig_rel = record["original_path"]
        dest_rel = record["destination_path"]

        # Check existing undo status
        if record["status"] == OperationStatus.UNDONE.value or record["undo_status"] == UndoStatus.UNDONE.value:
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.UNDONE,
                original_path=orig_rel,
                destination_path=dest_rel or "",
                message="Operation has already been undone.",
            )

        if record["status"] != OperationStatus.COMPLETED.value or record["undo_status"] != UndoStatus.REVERSIBLE.value:
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.UNREVERSIBLE,
                original_path=orig_rel,
                destination_path=dest_rel or "",
                message=f"Operation cannot be undone (status: {record['status']}, undo_status: {record['undo_status']}).",
            )

        canonical_root = Path(record["target_root"]).resolve()
        current_file = (canonical_root / dest_rel).resolve()
        original_dest = (canonical_root / orig_rel).resolve()

        # Security check: Sandboxing
        try:
            if not current_file.is_relative_to(canonical_root) or not original_dest.is_relative_to(canonical_root):
                self.journal.mark_undo_blocked(operation_id, "Path escapes authorized scan root.")
                return UndoOperationResponse(
                    operation_id=operation_id,
                    status=UndoStatus.BLOCKED,
                    original_path=orig_rel,
                    destination_path=dest_rel,
                    message="Undo blocked: Security violation (path escapes authorized root).",
                )
        except AttributeError:
            try:
                current_file.relative_to(canonical_root)
                original_dest.relative_to(canonical_root)
            except ValueError:
                self.journal.mark_undo_blocked(operation_id, "Path escapes authorized scan root.")
                return UndoOperationResponse(
                    operation_id=operation_id,
                    status=UndoStatus.BLOCKED,
                    original_path=orig_rel,
                    destination_path=dest_rel,
                    message="Undo blocked: Security violation (path escapes authorized root).",
                )

        # Precondition 1: Moved file must still exist at destination
        if not current_file.exists() or not current_file.is_file():
            reason = "File no longer exists at expected destination path."
            self.journal.mark_undo_blocked(operation_id, reason)
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.BLOCKED,
                original_path=orig_rel,
                destination_path=dest_rel,
                message=f"Undo blocked: {reason}",
            )

        # Precondition 2: Original path must not be occupied (never overwrite!)
        if original_dest.exists():
            reason = "Original path is currently occupied by another file."
            self.journal.mark_undo_blocked(operation_id, reason)
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.BLOCKED,
                original_path=orig_rel,
                destination_path=dest_rel,
                message=f"Undo blocked: {reason}",
            )

        # Perform atomic reversal
        try:
            original_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(current_file), str(original_dest))

            # Clean up empty source directory if left empty
            try:
                if current_file.parent != canonical_root and not any(current_file.parent.iterdir()):
                    current_file.parent.rmdir()
            except OSError:
                pass

            self.journal.mark_undone(operation_id)
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.UNDONE,
                original_path=orig_rel,
                destination_path=dest_rel,
                message="Operation successfully undone and file restored to original location.",
            )

        except Exception as e:
            self.journal.mark_undo_failed(operation_id, str(e))
            return UndoOperationResponse(
                operation_id=operation_id,
                status=UndoStatus.UNREVERSIBLE,
                original_path=orig_rel,
                destination_path=dest_rel,
                message=f"Undo failed during move: {str(e)}",
            )

    def undo_plan(self, plan_id: str) -> UndoPlanResponse:
        """Undo all reversible operations associated with a cleanup plan in reverse order."""
        reversible_ops = self.journal.get_reversible_operations_for_plan(plan_id)
        results: List[UndoOperationResponse] = []

        undone = 0
        blocked = 0
        failed = 0

        for op in reversible_ops:
            res = self.undo_operation(op["operation_id"])
            results.append(res)
            if res.status == UndoStatus.UNDONE:
                undone += 1
            elif res.status == UndoStatus.BLOCKED:
                blocked += 1
            else:
                failed += 1

        return UndoPlanResponse(
            plan_id=plan_id,
            total_operations=len(reversible_ops),
            undone_operations=undone,
            blocked_operations=blocked,
            failed_operations=failed,
            results=results,
        )


# Global singleton instance of ExecutionService
execution_service = ExecutionService()

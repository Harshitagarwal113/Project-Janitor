from pathlib import Path
import shutil
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.operation import (
    ExecutePlanRequest,
    OperationStatus,
    UndoStatus,
)
from app.schemas.plan import (
    CleanupPlanItem,
    CleanupPlanRequest,
    CleanupPlanResponse,
    CleanupPlanSummary,
    PlanActionType,
)
from app.schemas.scan import FileCategory
from app.services.executor import ExecutionService, execution_service
from app.services.journal import OperationJournalService, operation_journal
from app.services.plan import cleanup_plan_service
from app.services.scanner import scanner_service


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def temp_journal(tmp_path: Path):
    """Fixture providing an isolated SQLite journal in a dedicated directory outside user scan directories."""
    journal_dir = tmp_path.parent / f"journal_dir_{tmp_path.name}"
    journal_dir.mkdir(parents=True, exist_ok=True)
    db_file = journal_dir / "test_journal.db"
    return OperationJournalService(db_path=str(db_file))



@pytest.fixture
def temp_executor(temp_journal: OperationJournalService):
    """Fixture providing an isolated ExecutionService bound to the temp journal."""
    return ExecutionService(journal=temp_journal)


# ---------------------------------------------------------------------------
# Approval & Validation Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_approval_enforcement(tmp_path: Path, temp_executor: ExecutionService):
    """Test that plan execution is strictly rejected without explicit confirmation approval."""
    (tmp_path / "test.txt").write_bytes(b"content")
    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    # Rejection when confirm_approval is False
    with pytest.raises(ValueError) as exc:
        temp_executor.execute_plan(
            ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=False)
        )
    assert "explicit user approval" in str(exc.value).lower()

    # Rejection when plan_id is unknown
    with pytest.raises(KeyError):
        temp_executor.execute_plan(
            ExecutePlanRequest(plan_id="non-existent-plan-id", confirm_approval=True)
        )


@pytest.mark.anyio
async def test_stale_plan_rejected_source_missing(
    tmp_path: Path, temp_executor: ExecutionService
):
    """Test that if a source file is deleted after planning, execution rejects the stale plan."""
    f1 = tmp_path / "file_to_delete.txt"
    f1.write_bytes(b"temp")

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    # Delete source file before execution
    f1.unlink()

    # Execution must fail prevalidation
    with pytest.raises(ValueError) as exc:
        temp_executor.execute_plan(
            ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
        )
    assert "stale plan" in str(exc.value).lower()
    assert "no longer exists" in str(exc.value).lower()


@pytest.mark.anyio
async def test_stale_plan_rejected_destination_conflict(
    tmp_path: Path, temp_executor: ExecutionService
):
    """Test that if destination becomes occupied before execution, plan is rejected to prevent overwrite."""
    (tmp_path / "data.csv").write_bytes(b"1,2,3")
    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    # Create a conflict file at the proposed destination before execution
    target_dest = tmp_path / "Documents" / "data.csv"
    target_dest.parent.mkdir(parents=True, exist_ok=True)
    target_dest.write_bytes(b"Unrelated file created by user")

    with pytest.raises(ValueError) as exc:
        temp_executor.execute_plan(
            ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
        )
    assert "destination conflict" in str(exc.value).lower()


@pytest.mark.anyio
async def test_path_traversal_destination_rejected(
    tmp_path: Path, temp_executor: ExecutionService
):
    """Test that a malicious plan item attempting to escape the authorized root is rejected."""
    canonical_root = tmp_path.resolve()
    # Craft an illegitimate plan item attempting traversal
    malicious_item = CleanupPlanItem(
        item_id="bad-item",
        original_path="safe.txt",
        proposed_path="../outside_root.txt",
        action=PlanActionType.MOVE,
        category=FileCategory.DOCUMENTS,
        size_bytes=10,
        reason="Malicious move",
    )
    (tmp_path / "safe.txt").write_bytes(b"safe")

    bad_plan = CleanupPlanResponse(
        plan_id="bad-plan",
        scan_id="scan-1",
        target_path=str(canonical_root),
        created_at="2026-10-23T00:00:00Z",
        summary=CleanupPlanSummary(
            total_files=1,
            moves=1,
            renames=0,
            skips=0,
            duplicates_flagged=0,
            ai_suggestions_used=0,
            conflicts_resolved=0,
        ),
        items=[malicious_item],
    )

    with pytest.raises(ValueError) as exc:
        temp_executor.validate_plan_before_execution(bad_plan, canonical_root)
    assert "escapes authorized root" in str(exc.value).lower()


# ---------------------------------------------------------------------------
# Execution Functional Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_successful_plan_execution_and_journaling(
    tmp_path: Path, temp_executor: ExecutionService, temp_journal: OperationJournalService
):
    """Test full execution of moves and verify filesystem and SQLite journal."""
    content1 = b"PDF document content"
    content2 = b"Image JPEG content"

    (tmp_path / "report.pdf").write_bytes(content1)
    (tmp_path / "photo.jpg").write_bytes(content2)

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    response = temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )

    assert response.status == "completed"
    assert response.successful_operations == 2
    assert response.failed_operations == 0

    # Verify filesystem changes
    dest1 = tmp_path / "Documents" / "report.pdf"
    dest2 = tmp_path / "Images" / "photo.jpg"
    assert dest1.exists()
    assert dest2.exists()
    assert dest1.read_bytes() == content1
    assert dest2.read_bytes() == content2

    # Original files should no longer be at root
    assert not (tmp_path / "report.pdf").exists()
    assert not (tmp_path / "photo.jpg").exists()

    # Verify SQLite journal persistence
    total, items = temp_journal.list_operations(plan_id=plan.plan_id)
    assert total == 2
    assert all(item.status == OperationStatus.COMPLETED for item in items)
    assert all(item.undo_status == UndoStatus.REVERSIBLE for item in items)


@pytest.mark.anyio
async def test_duplicate_flags_are_not_deleted(
    tmp_path: Path, temp_executor: ExecutionService
):
    """Test that duplicate-flagged files are preserved and never deleted during execution."""
    sub1 = tmp_path / "folder1"
    sub2 = tmp_path / "folder2"
    sub1.mkdir()
    sub2.mkdir()

    content = b"Duplicated content"
    f1 = sub1 / "orig.txt"
    f2 = sub2 / "dup.txt"
    f1.write_bytes(content)
    f2.write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    # The plan should have flagged the duplicate
    assert any(i.action == PlanActionType.DUPLICATE_FLAG for i in plan.items)

    response = temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )

    # Both files must still exist! (Neither was deleted)
    # One may have been moved into Documents/, but both contents still exist
    all_files = list(tmp_path.rglob("*.txt"))
    assert len(all_files) == 2
    for f in all_files:
        assert f.read_bytes() == content


@pytest.mark.anyio
async def test_partial_failure_honestly_reported(
    tmp_path: Path, temp_executor: ExecutionService, temp_journal: OperationJournalService
):
    """Test honest reporting when one operation succeeds and another fails."""
    (tmp_path / "good.txt").write_bytes(b"Good file")
    (tmp_path / "bad.txt").write_bytes(b"Will fail move")

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    original_shutil_move = shutil.move

    def mock_move(src, dest):
        if "bad.txt" in str(src):
            raise PermissionError("Simulated OS lock or permission denied")
        return original_shutil_move(src, dest)

    with patch("shutil.move", side_effect=mock_move):
        response = temp_executor.execute_plan(
            ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
        )

    assert response.status == "partially_completed"
    assert response.successful_operations == 1
    assert response.failed_operations == 1

    # Check journal has both recorded
    total, items = temp_journal.list_operations(plan_id=plan.plan_id)
    assert total == 2
    failed_item = next(i for i in items if i.status == OperationStatus.FAILED)
    assert "Simulated OS lock" in failed_item.error_message
    assert failed_item.undo_status == UndoStatus.UNREVERSIBLE


# ---------------------------------------------------------------------------
# Undo Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_safe_undo_reverses_move(
    tmp_path: Path, temp_executor: ExecutionService, temp_journal: OperationJournalService
):
    """Test that a completed operation is safely reversed back to its original path."""
    content = b"Reversible content"
    (tmp_path / "important.doc").write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    exec_resp = temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )
    op_id = exec_resp.operations[0].operation_id

    # Verify moved
    dest_path = tmp_path / "Documents" / "important.doc"
    assert dest_path.exists()
    assert not (tmp_path / "important.doc").exists()

    # Perform Undo
    undo_resp = temp_executor.undo_operation(op_id)
    assert undo_resp.status == UndoStatus.UNDONE

    # Verify restored to original location
    orig_path = tmp_path / "important.doc"
    assert orig_path.exists()
    assert orig_path.read_bytes() == content
    assert not dest_path.exists()

    # Verify journal updated
    record = temp_journal.get_operation(op_id)
    assert record["status"] == OperationStatus.UNDONE.value
    assert record["undo_status"] == UndoStatus.UNDONE.value


@pytest.mark.anyio
async def test_undo_blocked_if_file_missing_at_destination(
    tmp_path: Path, temp_executor: ExecutionService, temp_journal: OperationJournalService
):
    """Test that undo is safely blocked if the moved file was removed externally."""
    (tmp_path / "temp.log").write_bytes(b"Logs")
    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    exec_resp = temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )
    op_id = exec_resp.operations[0].operation_id

    # Simulate user deleting the file from destination
    dest_rel = exec_resp.operations[0].destination_path
    dest_path = tmp_path / dest_rel
    if dest_path.exists():
        dest_path.unlink()

    undo_resp = temp_executor.undo_operation(op_id)
    assert undo_resp.status == UndoStatus.BLOCKED
    assert "no longer exists" in undo_resp.message.lower()

    record = temp_journal.get_operation(op_id)
    assert record["undo_status"] == UndoStatus.BLOCKED.value


@pytest.mark.anyio
async def test_undo_blocked_if_original_path_occupied(
    tmp_path: Path, temp_executor: ExecutionService, temp_journal: OperationJournalService
):
    """Test that undo is safely blocked if a new file now occupies the original location (never overwrite!)."""
    (tmp_path / "data.json").write_bytes(b"Original JSON")
    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    exec_resp = temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )
    op_id = exec_resp.operations[0].operation_id

    # Create a new file at original location
    (tmp_path / "data.json").write_bytes(b"New file created after move")

    undo_resp = temp_executor.undo_operation(op_id)
    assert undo_resp.status == UndoStatus.BLOCKED
    assert "occupied" in undo_resp.message.lower()

    # The new file must not have been overwritten!
    assert (tmp_path / "data.json").read_bytes() == b"New file created after move"


@pytest.mark.anyio
async def test_undo_plan_reverses_all_operations(
    tmp_path: Path, temp_executor: ExecutionService
):
    """Test undoing an entire plan in reverse order."""
    (tmp_path / "f1.txt").write_bytes(b"file 1")
    (tmp_path / "f2.txt").write_bytes(b"file 2")

    scan = scanner_service.scan(str(tmp_path))
    plan = await cleanup_plan_service.generate_plan(CleanupPlanRequest(scan_id=scan.scan_id))

    temp_executor.execute_plan(
        ExecutePlanRequest(plan_id=plan.plan_id, confirm_approval=True)
    )

    undo_plan_resp = temp_executor.undo_plan(plan.plan_id)
    assert undo_plan_resp.total_operations == 2
    assert undo_plan_resp.undone_operations == 2
    assert undo_plan_resp.blocked_operations == 0

    assert (tmp_path / "f1.txt").exists()
    assert (tmp_path / "f2.txt").exists()


# ---------------------------------------------------------------------------
# API Endpoints Integration Tests
# ---------------------------------------------------------------------------

def test_api_execute_and_undo_endpoints(client: TestClient, tmp_path: Path):
    """Test API endpoints for plan execution, journal listing, and undo."""
    (tmp_path / "invoice.pdf").write_bytes(b"Invoice 2026")

    scan_resp = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    scan_id = scan_resp.json()["scan_id"]

    plan_resp = client.post("/api/v1/plans", json={"scan_id": scan_id})
    plan_id = plan_resp.json()["plan_id"]

    # Execute without approval confirmation -> 400
    bad_exec = client.post(
        "/api/v1/operations/execute",
        json={"plan_id": plan_id, "confirm_approval": False},
    )
    assert bad_exec.status_code == 400

    # Execute with explicit approval -> 200
    exec_resp = client.post(
        "/api/v1/operations/execute",
        json={"plan_id": plan_id, "confirm_approval": True},
    )
    assert exec_resp.status_code == 200
    exec_data = exec_resp.json()
    assert exec_data["status"] == "completed"
    assert exec_data["successful_operations"] == 1
    op_id = exec_data["operations"][0]["operation_id"]

    # Query single operation
    op_resp = client.get(f"/api/v1/operations/{op_id}")
    assert op_resp.status_code == 200
    assert op_resp.json()["operation_id"] == op_id

    # Query operations journal
    list_resp = client.get(f"/api/v1/operations?plan_id={plan_id}")
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] >= 1

    # Undo single operation
    undo_resp = client.post(f"/api/v1/operations/{op_id}/undo")
    assert undo_resp.status_code == 200
    assert undo_resp.json()["status"] == "undone"

    # Verify original file restored
    assert (tmp_path / "invoice.pdf").exists()

    # Undo plan endpoint
    undo_plan_resp = client.post(f"/api/v1/operations/undo-plan/{plan_id}")
    assert undo_plan_resp.status_code == 200

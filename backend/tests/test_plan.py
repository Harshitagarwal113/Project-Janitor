from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.ai import AIClassificationResponse, AIModelStatus
from app.schemas.plan import (
    CleanupPlanRequest,
    OrganizationPreferences,
    PlanActionType,
)
from app.schemas.scan import FileCategory
from app.services.ollama import OllamaResponseValidationError, ollama_service
from app.services.plan import cleanup_plan_service
from app.services.scanner import scanner_service


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Functional Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_normal_categorization_plan(tmp_path: Path):
    """Test standard deterministic plan generation across multiple file categories."""
    # Create test directory with diverse files
    (tmp_path / "report.pdf").write_bytes(b"Document content")
    (tmp_path / "photo.jpg").write_bytes(b"Image content")
    (tmp_path / "script.py").write_bytes(b"Code content")
    (tmp_path / "archive.zip").write_bytes(b"Zip content")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(scan_id=scan.scan_id)

    plan = await cleanup_plan_service.generate_plan(req)

    assert plan.scan_id == scan.scan_id
    assert plan.target_path == str(tmp_path)
    assert plan.summary.total_files == 4
    assert plan.summary.moves >= 3

    # Check proposed paths
    item_map = {item.original_path: item for item in plan.items}

    assert item_map["report.pdf"].action in [PlanActionType.MOVE, PlanActionType.MOVE_AND_RENAME]
    assert item_map["report.pdf"].proposed_path == "Documents/report.pdf"
    assert item_map["report.pdf"].category == FileCategory.DOCUMENTS

    assert item_map["photo.jpg"].proposed_path == "Images/photo.jpg"
    assert item_map["photo.jpg"].category == FileCategory.IMAGES

    assert item_map["script.py"].proposed_path == "Code/script.py"
    assert item_map["script.py"].category == FileCategory.CODE

    assert item_map["archive.zip"].proposed_path == "Archives/archive.zip"
    assert item_map["archive.zip"].category == FileCategory.ARCHIVES


@pytest.mark.anyio
async def test_duplicate_flags_for_manual_review(tmp_path: Path):
    """Test that exact duplicate copies are strictly flagged for user review and never auto-deleted."""
    sub1 = tmp_path / "folder1"
    sub2 = tmp_path / "folder2"
    sub3 = tmp_path / "folder3"
    sub1.mkdir()
    sub2.mkdir()
    sub3.mkdir()

    content = b"Exact identical duplicated content across 3 files"
    (sub1 / "doc.pdf").write_bytes(content)
    (sub2 / "doc_copy.pdf").write_bytes(content)
    (sub3 / "doc_backup.pdf").write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(
        scan_id=scan.scan_id,
        preferences=OrganizationPreferences(flag_duplicates=True),
    )

    plan = await cleanup_plan_service.generate_plan(req)

    # 3 identical files -> 1 primary retained copy + 2 flagged duplicate copies
    assert plan.summary.total_files == 3
    assert plan.summary.duplicates_flagged == 2

    flagged_items = [i for i in plan.items if i.action == PlanActionType.DUPLICATE_FLAG]
    assert len(flagged_items) == 2
    for item in flagged_items:
        assert item.proposed_path is None
        assert "duplicate" in item.reason.lower()
        assert "exact sha-256 duplicate copy" in item.reason.lower()

    # The retained copy should NOT be flagged for deletion
    retained_items = [i for i in plan.items if i.action != PlanActionType.DUPLICATE_FLAG]
    assert len(retained_items) == 1
    assert retained_items[0].action != PlanActionType.DUPLICATE_FLAG


@pytest.mark.anyio
async def test_destination_collision_resolution_prevents_overwrite(tmp_path: Path):
    """Test that multiple files mapping to the same destination name are resolved safely with numerical suffixes."""
    sub_a = tmp_path / "folder_a"
    sub_b = tmp_path / "folder_b"
    sub_c = tmp_path / "folder_c"
    sub_a.mkdir()
    sub_b.mkdir()
    sub_c.mkdir()

    # Three files with different content but the same filename
    (sub_a / "notes.txt").write_bytes(b"Notes from meeting A")
    (sub_b / "notes.txt").write_bytes(b"Different notes from B")
    (sub_c / "notes.txt").write_bytes(b"Completely different C")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(scan_id=scan.scan_id)

    plan = await cleanup_plan_service.generate_plan(req)

    assert plan.summary.total_files == 3
    # Collisions must be detected and resolved
    assert plan.summary.conflicts_resolved >= 2

    # Check that all proposed destination paths are strictly unique (no overwriting!)
    proposed_paths = [item.proposed_path for item in plan.items if item.proposed_path]
    assert len(proposed_paths) == len(set(proposed_paths))

    # Expect notes.txt, notes_1.txt, notes_2.txt
    assert "Documents/notes.txt" in proposed_paths
    assert "Documents/notes_1.txt" in proposed_paths
    assert "Documents/notes_2.txt" in proposed_paths


@pytest.mark.anyio
async def test_existing_disk_file_collision_prevents_overwrite(tmp_path: Path):
    """Test that if destination already exists on disk, the plan resolves with numerical suffix to prevent overwrite."""
    # Pre-existing file at the target destination
    docs_dir = tmp_path / "Documents"
    docs_dir.mkdir()
    existing_dest = docs_dir / "invoice.pdf"
    existing_dest.write_bytes(b"Pre-existing invoice on disk")

    # Source file in messy root that wants to move to Documents/invoice.pdf
    (tmp_path / "invoice.pdf").write_bytes(b"New invoice in root")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(scan_id=scan.scan_id)

    plan = await cleanup_plan_service.generate_plan(req)

    item_map = {item.original_path: item for item in plan.items}
    # The file in Documents/invoice.pdf is already in the right place -> SKIP
    assert item_map["Documents/invoice.pdf"].action == PlanActionType.SKIP

    # The file in root/invoice.pdf should be moved to Documents/invoice_1.pdf to prevent overwrite!
    root_item = item_map["invoice.pdf"]
    assert root_item.proposed_path == "Documents/invoice_1.pdf"
    assert root_item.has_conflict is True
    assert "conflict resolved" in root_item.reason.lower()


@pytest.mark.anyio
async def test_missing_ollama_graceful_fallback(tmp_path: Path):
    """Test that when Ollama is offline or unavailable, plan generation continues seamlessly with non-AI rules."""
    (tmp_path / "misc.dat").write_bytes(b"Miscellaneous binary data")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(
        scan_id=scan.scan_id,
        preferences=OrganizationPreferences(use_ai=True),
    )

    # Mock Ollama status returning service_available=False
    mock_status = AIModelStatus(
        service_available=False,
        model_installed=False,
        configured_model="gemma:2b",
        available_models=[],
        service_url="http://127.0.0.1:11434",
        message="Ollama offline",
    )

    with patch.object(ollama_service, "get_service_status", new_callable=AsyncMock, return_value=mock_status):
        plan = await cleanup_plan_service.generate_plan(req)

    assert plan.summary.total_files == 1
    assert plan.summary.ai_suggestions_used == 0
    item = plan.items[0]
    assert item.is_ai_suggested is False
    assert item.category == FileCategory.OTHER


@pytest.mark.anyio
async def test_invalid_model_response_graceful_fallback(tmp_path: Path):
    """Test that if the local model returns invalid output, the planner falls back to deterministic rules."""
    (tmp_path / "untitled_data.txt").write_bytes(b"Some text")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(
        scan_id=scan.scan_id,
        preferences=OrganizationPreferences(use_ai=True),
    )

    mock_status = AIModelStatus(
        service_available=True,
        model_installed=True,
        configured_model="gemma:2b",
        available_models=["gemma:2b"],
        service_url="http://127.0.0.1:11434",
        message="Ollama online",
    )

    with patch.object(ollama_service, "get_service_status", new_callable=AsyncMock, return_value=mock_status):
        with patch.object(
            ollama_service,
            "classify_file",
            new_callable=AsyncMock,
            side_effect=OllamaResponseValidationError("Model produced invalid json"),
        ):
            plan = await cleanup_plan_service.generate_plan(req)

    # Should succeed without failing!
    assert plan.summary.total_files == 1
    assert plan.summary.ai_suggestions_used == 0
    item = plan.items[0]
    assert item.is_ai_suggested is False
    assert item.category == FileCategory.DOCUMENTS


@pytest.mark.anyio
async def test_valid_ai_suggestion_applied_and_labeled(tmp_path: Path):
    """Test that when local Gemma model is available, AI suggestions are applied and clearly labeled."""
    (tmp_path / "untitled_notes").write_bytes(b"Python utility functions")

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(
        scan_id=scan.scan_id,
        preferences=OrganizationPreferences(use_ai=True),
    )

    mock_status = AIModelStatus(
        service_available=True,
        model_installed=True,
        configured_model="gemma:2b",
        available_models=["gemma:2b"],
        service_url="http://127.0.0.1:11434",
        message="Ollama online",
    )

    mock_ai_resp = AIClassificationResponse(
        suggested_category=FileCategory.CODE,
        suggested_filename="utils.py",
        rationale="File contains Python source code functions.",
        confidence=0.92,
        model_used="gemma:2b",
        content_analyzed=True,
    )

    with patch.object(ollama_service, "get_service_status", new_callable=AsyncMock, return_value=mock_status):
        with patch.object(ollama_service, "classify_file", new_callable=AsyncMock, return_value=mock_ai_resp):
            plan = await cleanup_plan_service.generate_plan(req)

    assert plan.summary.ai_suggestions_used == 1
    item = plan.items[0]
    assert item.is_ai_suggested is True
    assert item.confidence == 0.92
    assert item.category == FileCategory.CODE
    assert item.proposed_path == "Code/utils.py"
    assert "AI suggestion" in item.reason


@pytest.mark.anyio
async def test_empty_scan_plan(tmp_path: Path):
    """Test plan generation on an empty directory returns a valid empty plan."""
    empty_sub = tmp_path / "empty_folder"
    empty_sub.mkdir()

    scan = scanner_service.scan(str(empty_sub))
    req = CleanupPlanRequest(scan_id=scan.scan_id)

    plan = await cleanup_plan_service.generate_plan(req)

    assert plan.summary.total_files == 0
    assert len(plan.items) == 0
    assert plan.summary.moves == 0
    assert plan.summary.renames == 0


@pytest.mark.anyio
async def test_strict_non_mutation_invariant(tmp_path: Path):
    """Strict verification: Generating a cleanup plan MUST NEVER modify, move, or delete any file."""
    content = b"Original content that must remain 100% unchanged"
    file1 = tmp_path / "important.docx"
    file2 = tmp_path / "nested" / "script.py"
    file2.parent.mkdir()
    file1.write_bytes(content)
    file2.write_bytes(content)

    mtime1_before = file1.stat().st_mtime_ns
    mtime2_before = file2.stat().st_mtime_ns

    scan = scanner_service.scan(str(tmp_path))
    req = CleanupPlanRequest(scan_id=scan.scan_id)

    plan = await cleanup_plan_service.generate_plan(req)

    # Verify plan was created
    assert len(plan.items) == 2

    # Verify files still exist in their original locations with identical content and timestamps
    assert file1.exists()
    assert file2.exists()
    assert file1.read_bytes() == content
    assert file2.read_bytes() == content
    assert file1.stat().st_mtime_ns == mtime1_before
    assert file2.stat().st_mtime_ns == mtime2_before


# ---------------------------------------------------------------------------
# API Endpoints Integration Tests
# ---------------------------------------------------------------------------

def test_api_create_and_get_plan(client: TestClient, tmp_path: Path):
    """Test POST /api/v1/plans and GET /api/v1/plans/{plan_id} via FastAPI client."""
    (tmp_path / "budget.xlsx").write_bytes(b"Spreadsheet data")
    (tmp_path / "app.js").write_bytes(b"console.log('hello');")

    scan_resp = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    assert scan_resp.status_code == 201
    scan_id = scan_resp.json()["scan_id"]

    # POST /api/v1/plans
    plan_resp = client.post(
        "/api/v1/plans",
        json={"scan_id": scan_id},
    )
    assert plan_resp.status_code == 201
    plan_data = plan_resp.json()
    assert plan_data["scan_id"] == scan_id
    assert "plan_id" in plan_data
    assert plan_data["summary"]["total_files"] == 2
    assert len(plan_data["items"]) == 2

    plan_id = plan_data["plan_id"]

    # GET /api/v1/plans/{plan_id}
    get_resp = client.get(f"/api/v1/plans/{plan_id}")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert get_data["plan_id"] == plan_id
    assert get_data["scan_id"] == scan_id

    # Test invalid plan_id
    not_found_resp = client.get("/api/v1/plans/non-existent-plan-id")
    assert not_found_resp.status_code == 404

    # Test invalid scan_id for plan creation
    invalid_scan_resp = client.post(
        "/api/v1/plans",
        json={"scan_id": "non-existent-scan-id"},
    )
    assert invalid_scan_resp.status_code == 404

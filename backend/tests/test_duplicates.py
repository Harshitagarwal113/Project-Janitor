import hashlib
import os
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.duplicate import duplicate_service
from app.services.scanner import scanner_service


@pytest.fixture
def client():
    return TestClient(app)


def test_identical_files_with_identical_names(tmp_path: Path):
    """Test duplicate detection when identical files have identical names in different subdirectories."""
    sub1 = tmp_path / "sub1"
    sub2 = tmp_path / "sub2"
    sub1.mkdir()
    sub2.mkdir()

    content = b"Exact identical content across different folders"
    file1 = sub1 / "document.pdf"
    file2 = sub2 / "document.pdf"
    file1.write_bytes(content)
    file2.write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))
    analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert analysis.total_groups == 1
    assert analysis.total_duplicate_files == 2
    assert analysis.reclaimable_bytes == len(content)

    group = analysis.groups[0]
    expected_hash = hashlib.sha256(content).hexdigest()
    assert group.hash == expected_hash
    assert group.size_bytes == len(content)
    assert group.reclaimable_bytes == len(content)
    assert len(group.files) == 2
    paths = [f.relative_path for f in group.files]
    assert "sub1/document.pdf" in paths
    assert "sub2/document.pdf" in paths


def test_identical_content_with_different_names(tmp_path: Path):
    """Test duplicate detection when identical content has different filenames."""
    content = b"Same content different names"
    file1 = tmp_path / "photo_original.jpg"
    file2 = tmp_path / "photo_copy.jpg"
    file3 = tmp_path / "backup_photo.jpg"

    file1.write_bytes(content)
    file2.write_bytes(content)
    file3.write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))
    analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert analysis.total_groups == 1
    assert analysis.total_duplicate_files == 3
    # 3 files of size len(content) -> (3 - 1) * len(content) = 2 * len(content) reclaimable
    assert analysis.reclaimable_bytes == 2 * len(content)

    group = analysis.groups[0]
    assert group.file_count == 3
    assert group.reclaimable_bytes == 2 * len(content)


def test_same_filename_with_different_content(tmp_path: Path):
    """Test that files with identical filenames but different content are NOT duplicates."""
    sub1 = tmp_path / "project_a"
    sub2 = tmp_path / "project_b"
    sub1.mkdir()
    sub2.mkdir()

    # Different content, same filename, same or different size
    file1 = sub1 / "config.json"
    file2 = sub2 / "config.json"
    file1.write_bytes(b'{"name": "project_a", "version": "1.0"}')
    file2.write_bytes(b'{"name": "project_b", "version": "2.0"}')

    scan = scanner_service.scan(str(tmp_path))
    analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    # They should NOT be grouped as duplicates
    assert analysis.total_groups == 0
    assert analysis.total_duplicate_files == 0
    assert analysis.reclaimable_bytes == 0


def test_empty_files(tmp_path: Path):
    """Test duplicate detection on multiple empty files (0 bytes)."""
    file1 = tmp_path / "empty1.txt"
    file2 = tmp_path / "empty2.txt"
    file3 = tmp_path / "empty3.log"
    file1.write_bytes(b"")
    file2.write_bytes(b"")
    file3.write_bytes(b"")

    scan = scanner_service.scan(str(tmp_path))
    analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert analysis.total_groups == 1
    assert analysis.total_duplicate_files == 3
    # Reclaimable bytes for 0-byte files must be 0
    assert analysis.reclaimable_bytes == 0

    group = analysis.groups[0]
    expected_empty_hash = hashlib.sha256(b"").hexdigest()
    assert group.hash == expected_empty_hash
    assert group.size_bytes == 0
    assert group.reclaimable_bytes == 0
    assert group.file_count == 3


def test_unreadable_files(tmp_path: Path):
    """Test safe handling when candidate file cannot be read during hashing."""
    content = b"Candidate duplicate content"
    file1 = tmp_path / "read1.dat"
    file2 = tmp_path / "read2.dat"
    file1.write_bytes(content)
    file2.write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))

    # Mock open to raise PermissionError on file2
    original_open = open

    def mock_open(file, *args, **kwargs):
        if Path(file).name == "read2.dat" and "rb" in args:
            raise PermissionError("Access denied by OS")
        return original_open(file, *args, **kwargs)

    with patch("builtins.open", side_effect=mock_open):
        analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    # Since file2 was unreadable, file1 has no match, so no duplicate group formed
    assert analysis.total_groups == 0
    assert len(analysis.skipped_files) == 1
    assert "read2.dat" in analysis.skipped_files[0].path
    assert "Permission denied" in analysis.skipped_files[0].reason


def test_files_changing_during_hashing(tmp_path: Path):
    """Test that a file changing size or modified timestamp during hashing is safely skipped."""
    content = b"Candidate duplicate content for mutation test"
    file1 = tmp_path / "mutable1.bin"
    file2 = tmp_path / "mutable2.bin"
    file1.write_bytes(content)
    file2.write_bytes(content)

    scan = scanner_service.scan(str(tmp_path))

    # Simulate post_stat returning a different modification timestamp (concurrent write)
    original_stat = duplicate_service._stat_file
    call_counts = {"mutable2.bin": 0}

    def mock_stat_func(path_obj: Path):
        st = original_stat(path_obj)
        if path_obj.name == "mutable2.bin":
            call_counts["mutable2.bin"] += 1
            if call_counts["mutable2.bin"] > 1:
                # Return mutated stat with modified timestamp on post-read check
                class MutatedStat:
                    st_size = st.st_size
                    st_mtime_ns = st.st_mtime_ns + 500000000  # 500ms later
                return MutatedStat()
        return st

    with patch.object(duplicate_service, "_stat_file", side_effect=mock_stat_func):
        analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert analysis.total_groups == 0
    assert len(analysis.skipped_files) >= 1
    assert any("mutable2.bin" in s.path and "modified" in s.reason.lower() for s in analysis.skipped_files)


def test_correct_reclaimable_byte_calculations(tmp_path: Path):
    """Test conservative reclaimable bytes across multiple duplicate groups and unique files."""
    # Group A: 4 copies of 250 bytes -> (4 - 1) * 250 = 750 bytes reclaimable
    content_a = b"A" * 250
    for i in range(4):
        (tmp_path / f"group_a_{i}.txt").write_bytes(content_a)

    # Group B: 2 copies of 1000 bytes -> (2 - 1) * 1000 = 1000 bytes reclaimable
    content_b = b"B" * 1000
    for i in range(2):
        (tmp_path / f"group_b_{i}.txt").write_bytes(content_b)

    # Unique files (should NOT be hashed or counted)
    (tmp_path / "unique_1.txt").write_bytes(b"unique 1")
    (tmp_path / "unique_2.txt").write_bytes(b"unique 2 with different length")

    scan = scanner_service.scan(str(tmp_path))
    analysis = duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert analysis.total_groups == 2
    assert analysis.total_duplicate_files == 6
    # Total reclaimable = 750 + 1000 = 1750 bytes
    assert analysis.reclaimable_bytes == 1750


def test_no_files_modified_or_deleted(tmp_path: Path):
    """Strict verification: duplicate detection MUST NOT modify, move, or delete any files."""
    content = b"Important user data that must never be modified"
    file1 = tmp_path / "file1.txt"
    file2 = tmp_path / "file2.txt"
    file1.write_bytes(content)
    file2.write_bytes(content)

    mtime1_before = file1.stat().st_mtime_ns
    mtime2_before = file2.stat().st_mtime_ns

    scan = scanner_service.scan(str(tmp_path))
    duplicate_service.analyze_duplicates(scan.scan_id, force_refresh=True)

    assert file1.exists()
    assert file2.exists()
    assert file1.read_bytes() == content
    assert file2.read_bytes() == content
    assert file1.stat().st_mtime_ns == mtime1_before
    assert file2.stat().st_mtime_ns == mtime2_before


def test_api_duplicate_endpoints(client: TestClient, tmp_path: Path):
    """Test POST /api/v1/duplicates and GET /api/v1/duplicates/{scan_id} via FastAPI client."""
    content = b"FastAPI client duplicate endpoint test"
    (tmp_path / "api_file1.txt").write_bytes(content)
    (tmp_path / "api_file2.txt").write_bytes(content)

    # Create scan first
    scan_resp = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    assert scan_resp.status_code == 201
    scan_id = scan_resp.json()["scan_id"]

    # Test POST /api/v1/duplicates
    dup_post_resp = client.post("/api/v1/duplicates", json={"scan_id": scan_id})
    assert dup_post_resp.status_code == 200
    data = dup_post_resp.json()
    assert data["scan_id"] == scan_id
    assert data["total_groups"] == 1
    assert data["total_duplicate_files"] == 2
    assert data["reclaimable_bytes"] == len(content)
    assert len(data["groups"]) == 1
    assert data["groups"][0]["hash"] == hashlib.sha256(content).hexdigest()

    # Test GET /api/v1/duplicates/{scan_id}
    dup_get_resp = client.get(f"/api/v1/duplicates/{scan_id}")
    assert dup_get_resp.status_code == 200
    get_data = dup_get_resp.json()
    assert get_data["scan_id"] == scan_id
    assert get_data["total_groups"] == 1

    # Test invalid scan_id
    invalid_resp = client.post("/api/v1/duplicates", json={"scan_id": "non-existent-scan-id"})
    assert invalid_resp.status_code == 404

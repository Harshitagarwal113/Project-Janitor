import os
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.scanner import scanner_service

client = TestClient(app)


def test_scan_empty_directory(tmp_path: Path):
    """Empty directories should return 0 files and 0 bytes without error."""
    response = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    assert response.status_code == 201
    data = response.json()

    assert data["scan_id"] is not None
    assert data["target_path"] == str(tmp_path.resolve())
    assert data["status"] == "completed"
    assert data["total_files"] == 0
    assert data["total_scanned_bytes"] == 0
    assert data["files"] == []
    assert data["has_more"] is False
    assert data["skipped_entries"] == []
    assert data["category_counts"]["documents"] == 0
    assert data["category_counts"]["other"] == 0

    # Retrieve by scan_id
    get_res = client.get(f"/api/v1/scan/{data['scan_id']}")
    assert get_res.status_code == 200
    assert get_res.json()["scan_id"] == data["scan_id"]


def test_scan_nested_directories_and_categories(tmp_path: Path):
    """Verify recursive scanning, category classification, and forward-slash relative paths."""
    # Create category files
    docs_dir = tmp_path / "documents"
    docs_dir.mkdir()
    (docs_dir / "report.pdf").write_bytes(b"PDF content")
    (docs_dir / "notes.txt").write_bytes(b"Notes content")

    img_dir = tmp_path / "media" / "images"
    img_dir.mkdir(parents=True)
    (img_dir / "logo.PNG").write_bytes(b"PNG image bytes")

    video_dir = tmp_path / "media" / "videos"
    video_dir.mkdir(parents=True)
    (video_dir / "movie.mp4").write_bytes(b"MP4 video bytes")

    audio_dir = tmp_path / "audio"
    audio_dir.mkdir()
    (audio_dir / "track.mp3").write_bytes(b"MP3 audio bytes")

    archive_dir = tmp_path / "archives"
    archive_dir.mkdir()
    (archive_dir / "bundle.tar.gz").write_bytes(b"Tar gz bytes")

    code_dir = tmp_path / "src"
    code_dir.mkdir()
    (code_dir / "index.ts").write_bytes(b"const x = 1;")

    other_dir = tmp_path / "other"
    other_dir.mkdir()
    (other_dir / "unknown.dat").write_bytes(b"Unknown binary")
    (other_dir / "no_extension").write_bytes(b"No ext")

    response = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    assert response.status_code == 201
    data = response.json()

    assert data["total_files"] == 9
    assert data["total_scanned_bytes"] > 0

    counts = data["category_counts"]
    assert counts["documents"] == 2
    assert counts["images"] == 1
    assert counts["videos"] == 1
    assert counts["audio"] == 1
    assert counts["archives"] == 1
    assert counts["code"] == 1
    assert counts["other"] == 2

    # Check that paths are relative and normalized with forward slashes
    rel_paths = [f["relative_path"] for f in data["files"]]
    assert "documents/report.pdf" in rel_paths
    assert "documents/notes.txt" in rel_paths
    assert "media/images/logo.PNG" in rel_paths
    assert "media/videos/movie.mp4" in rel_paths
    assert "audio/track.mp3" in rel_paths
    assert "src/index.ts" in rel_paths

    # Verify metadata fields
    pdf_file = next(f for f in data["files"] if f["filename"] == "report.pdf")
    assert pdf_file["extension"] == ".pdf"
    assert pdf_file["category"] == "documents"
    assert pdf_file["size_bytes"] == len(b"PDF content")
    assert "T" in pdf_file["modified_at"]


def test_pagination(tmp_path: Path):
    """Verify limit, offset, and has_more behavior for bounded results."""
    for i in range(12):
        (tmp_path / f"file_{i:02d}.txt").write_text(f"content {i}")

    # First page
    res1 = client.post(
        "/api/v1/scan?limit=5&offset=0", json={"target_path": str(tmp_path)}
    )
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["total_files"] == 12
    assert len(data1["files"]) == 5
    assert data1["limit"] == 5
    assert data1["offset"] == 0
    assert data1["has_more"] is True
    scan_id = data1["scan_id"]
    files1 = [f["filename"] for f in data1["files"]]

    # Second page
    res2 = client.get(f"/api/v1/scan/{scan_id}?limit=5&offset=5")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["files"]) == 5
    assert data2["offset"] == 5
    assert data2["has_more"] is True
    files2 = [f["filename"] for f in data2["files"]]

    # Third page (remaining 2)
    res3 = client.get(f"/api/v1/scan/{scan_id}?limit=5&offset=10")
    assert res3.status_code == 200
    data3 = res3.json()
    assert len(data3["files"]) == 2
    assert data3["offset"] == 10
    assert data3["has_more"] is False
    files3 = [f["filename"] for f in data3["files"]]

    # No duplicate items across pagination
    assert set(files1).isdisjoint(set(files2))
    assert set(files2).isdisjoint(set(files3))
    assert len(files1 + files2 + files3) == 12


def test_missing_and_invalid_paths(tmp_path: Path):
    """Validate error handling on missing, empty, or non-directory paths."""
    # Empty path
    res = client.post("/api/v1/scan", json={"target_path": "   "})
    assert res.status_code == 400
    assert "empty" in res.json()["detail"].lower()

    # Relative path
    res = client.post("/api/v1/scan", json={"target_path": "some/relative/path"})
    assert res.status_code == 400
    assert "absolute" in res.json()["detail"].lower()

    # Missing path
    missing_dir = tmp_path / "does_not_exist"
    res = client.post("/api/v1/scan", json={"target_path": str(missing_dir)})
    assert res.status_code == 404
    assert "does not exist" in res.json()["detail"].lower()

    # File as target path
    file_path = tmp_path / "test.txt"
    file_path.write_text("hello")
    res = client.post("/api/v1/scan", json={"target_path": str(file_path)})
    assert res.status_code == 400
    assert "not a directory" in res.json()["detail"].lower()


def test_drive_root_rejection():
    """Verify that scanning an entire drive root is strictly prohibited."""
    drive_root = Path(Path.cwd().anchor)
    res = client.post("/api/v1/scan", json={"target_path": str(drive_root)})
    assert res.status_code == 400
    assert "drive root" in res.json()["detail"].lower()


def test_scan_not_found():
    """Requesting an unknown scan_id should return 404."""
    res = client.get("/api/v1/scan/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_permission_error_handling(tmp_path: Path):
    """Inaccessible subdirectories should be skipped safely without aborting the scan."""
    (tmp_path / "accessible.txt").write_text("accessible")
    sub_dir = tmp_path / "restricted"
    sub_dir.mkdir()
    (sub_dir / "secret.txt").write_text("secret")

    original_scandir = os.scandir

    def mock_scandir(path):
        if Path(path).resolve() == sub_dir.resolve():
            raise PermissionError("Access denied")
        return original_scandir(path)

    with patch("os.scandir", side_effect=mock_scandir):
        res = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
        assert res.status_code == 201
        data = res.json()
        assert data["total_files"] == 1
        assert data["files"][0]["filename"] == "accessible.txt"
        assert len(data["skipped_entries"]) == 1
        assert "access denied" in data["skipped_entries"][0]["reason"].lower()


def test_symbolic_link_outside_root(tmp_path: Path):
    """Symbolic links pointing outside the authorized root must not be traversed."""
    root_dir = tmp_path / "root"
    root_dir.mkdir()
    (root_dir / "inside.txt").write_text("inside")

    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside_file = outside_dir / "outside.txt"
    outside_file.write_text("outside")

    symlink_target = root_dir / "link_to_outside.txt"
    try:
        symlink_target.symlink_to(outside_file)
    except (OSError, NotImplementedError):
        pytest.skip("Symlink creation not supported in current environment/permissions")

    res = client.post("/api/v1/scan", json={"target_path": str(root_dir)})
    assert res.status_code == 201
    data = res.json()

    # The inside file must be scanned
    scanned_filenames = [f["filename"] for f in data["files"]]
    assert "inside.txt" in scanned_filenames
    # The outside target must NOT be traversed as a scanned file
    assert "outside.txt" not in scanned_filenames

    # Should be flagged in skipped entries
    skipped_reasons = [s["reason"] for s in data["skipped_entries"]]
    assert any("outside authorized root" in r.lower() for r in skipped_reasons)


def test_files_never_modified(tmp_path: Path):
    """Verify scanner is strictly read-only and never modifies file content or metadata."""
    test_file = tmp_path / "immutable.txt"
    test_file.write_text("do not modify")
    stat_before = test_file.stat()

    res = client.post("/api/v1/scan", json={"target_path": str(tmp_path)})
    assert res.status_code == 201

    stat_after = test_file.stat()
    assert stat_before.st_mtime == stat_after.st_mtime
    assert stat_before.st_size == stat_after.st_size
    assert test_file.read_text() == "do not modify"


def test_mocked_symbolic_link_outside_root(tmp_path: Path):
    """Ensure symlink pointing outside authorized root is skipped even if OS symlinks are disabled."""
    root_dir = tmp_path / "root"
    root_dir.mkdir()
    inside_file = root_dir / "inside.txt"
    inside_file.write_text("inside")
    fake_link = root_dir / "fake_symlink.txt"
    fake_link.write_text("dummy")

    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("outside")

    class MockDirEntry:
        def __init__(self, name, path, is_sym, is_fl, is_dr):
            self.name = name
            self.path = path
            self._is_sym = is_sym
            self._is_fl = is_fl
            self._is_dr = is_dr

        def is_symlink(self):
            return self._is_sym

        def is_file(self, follow_symlinks=True):
            return self._is_fl

        def is_dir(self, follow_symlinks=True):
            return self._is_dr

        def stat(self, follow_symlinks=True):
            return Path(self.path).stat()

    mock_entries = [
        MockDirEntry("inside.txt", str(inside_file), False, True, False),
        MockDirEntry("fake_symlink.txt", str(fake_link), True, True, False),
    ]

    class MockScandirContext:
        def __enter__(self):
            return mock_entries

        def __exit__(self, *args):
            pass

        def __iter__(self):
            return iter(mock_entries)

    original_scandir = os.scandir

    def mock_scandir(p):
        if Path(p).resolve() == root_dir.resolve():
            return MockScandirContext()
        return original_scandir(p)

    def mock_resolve_entry(entry_p):
        if entry_p.name == "fake_symlink.txt":
            return outside_file.resolve()
        return entry_p.resolve()

    with patch("os.scandir", side_effect=mock_scandir), patch.object(
        scanner_service, "_resolve_entry", side_effect=mock_resolve_entry
    ):
        res = client.post("/api/v1/scan", json={"target_path": str(root_dir)})
        assert res.status_code == 201
        data = res.json()
        scanned = [f["filename"] for f in data["files"]]
        assert "inside.txt" in scanned
        assert "fake_symlink.txt" not in scanned
        skipped_reasons = [s["reason"] for s in data["skipped_entries"]]
        assert any("outside authorized root" in r.lower() for r in skipped_reasons)

